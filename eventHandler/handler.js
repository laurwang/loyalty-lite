

const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies

const WF = require('workfront-subscriptions')

const wf = WF(process.env.WFAPI_KEY, process.env.WFAPI_ENDPOINT, process.env.WFOBJ_CODES_EVENT_TYPES)

const AJV = require('ajv')

const ajv = new AJV()
const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`

// To validate it is a Workfront subscription event
const wfEnvelopeSchema = wf.getEnvelopeSchema()
const wfEnvelope = makeSchemaId(wfEnvelopeSchema)
ajv.addSchema(wfEnvelopeSchema, wfEnvelope)

// TODO is this overkill checking here?  Should this be down to the event consumers instead?
// To validate the fields payload. NB Some services may wish to add to the list of required fields in the schemas.
// TODO figure out what all the possible fields are, then set additionalProperties false.  Also, may need to allow nulls
// for some fields, based on errors from (non-Store-Events) events.
// TODO put in something for the other objCodes' schemas.
const OBJECTS_FOR_FIELD_CHECK = wf.getObjCodes()
for (let i = 0; i < OBJECTS_FOR_FIELD_CHECK.length; i++) {
  const schemaToAdd = wf.getPayloadSchema(OBJECTS_FOR_FIELD_CHECK[i])
  if (schemaToAdd) {
    ajv.addSchema(schemaToAdd, makeSchemaId(schemaToAdd))
  }
}

const constants = {
  INVALID_REQUEST: 'Invalid Request: could not validate request to the schema provided.',
  INTEGRATION_ERROR: 'Kinesis Integration Error',
  API_NAME: 'Event Handler',
}

const impl = {
  // check these are ok (i.e., Workfront does not keep trying to deliver the same event, unless something goes wrong, though Kinesis error is not really their problem, but still nice to get the re-delivery).
  response: (statusCode, body) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*', // Required for CORS support to work
      'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
    },
    body,
  }),

  clientError: (error, event) => {
    console.log(error)
    return impl.response(400, `${constants.API_NAME} ${constants.INVALID_REQUEST}  ${error}.  Event: '${JSON.stringify(event)}'`)
  },

  kinesisError: (schemaName, err) => {
    console.log(err)
    return impl.response(500, `${constants.API_NAME} - ${constants.INTEGRATION_ERROR} trying to write an event for '${JSON.stringify(schemaName)}'`)
  },

  success: response => impl.response(200, JSON.stringify(response)),

  validateAndWriteKinesisEventFromApiEndpoint(event, callback) {
    const received = new Date().toISOString()
    const eventData = JSON.parse(event.body)
    console.log('WFE', eventData)

    // TODO less verbose errors
    if (!ajv.validate(wfEnvelope, eventData)) {
      callback(null, impl.clientError(`Could not validate event as a Workfront subscription event.  Errors: ${ajv.errorsText()}`, eventData))
    } else if (eventData.eventType !== 'DELETE' && OBJECTS_FOR_FIELD_CHECK.indexOf(eventData.newState.objCode) > -1 && !ajv.validate(`com.nordstrom/workfront/${eventData.newState.objCode}/1-0-0`, eventData.newState)) {
      callback(null, impl.clientError(`Could not validate the newState payload to the schema for ${eventData.newState.objCode} .  Errors: ${ajv.errorsText()}`, eventData.newState))
    } else if (eventData.eventType === 'CREATE' && Object.keys(eventData.oldState).length === 0) { // a true CREATE event, i.e., no previous state available
      const origin = `workfront/${eventData.newState.objCode}/CREATE/${eventData.newState.categoryID}`
      eventData.newState.schema = `com.nordstrom/${origin}/1-0-0`
      console.log('constructed schema for payload fields', eventData.newState.schema) // TODO remove

      const kinesis = new aws.Kinesis()
      const newEvent = {
        Data: JSON.stringify({
          schema: 'com.nordstrom/workfront/stream-ingress/1-0-0', // see ./schemas/stream-ingress in the workfront-subscriptions node module for reference
          timeOrigin: received, // TODO flag and handle re-try by looking at Workfront timestamp and received timestamp.  Use Workfront timestamp instead here.
          data: eventData.newState,
          origin,
        }),
        PartitionKey: eventData.newState.ID,
        StreamName: process.env.STREAM_NAME,
      }

      kinesis.putRecord(newEvent, (err, data) => {
        if (err) {
          callback(null, impl.kinesisError(eventData.newState.schema, err))
        } else {
          callback(null, impl.success(data))
        }
      })
    } else if (OBJECTS_FOR_FIELD_CHECK.indexOf(eventData.oldState.objCode) > -1 && !ajv.validate(`com.nordstrom/workfront/${eventData.oldState.objCode}/1-0-0`, eventData.oldState)) {
      callback(null, impl.clientError(`Could not validate the oldState payload to the schema for ${eventData.oldState.objCode} .  Errors: ${ajv.errorsText()}`, eventData.oldState))
    } else if (eventData.eventType !== 'DELETE' && (eventData.oldState.objCode !== eventData.newState.objCode || eventData.oldState.ID !== eventData.newState.ID)) { // call out inexplicable changes to state.  This *should* never be satisfied, or something odd is going on with Workfront.
      callback(null, impl.clientError(`Object code or ID has changed for ${eventData.oldState.ID}, ${eventData.oldState.objCode}.`, eventData.newState))
    } else { // NB all routing info like origin or schema are constructed using the oldState, because--if some abuse of Workfront functionality is going on--we either will do nothing or we will reinstate the oldState, which is considered the last ok set of details.
      const origin = `workfront/${eventData.oldState.objCode}/${eventData.eventType}/${eventData.oldState.categoryID}` // Should reflect whether it was from a WF CREATE or UPDATE (or DELETE, though that hasn't a Workfront ambiguity issue)
      const keyId = eventData.oldState.ID
      const objCode = eventData.oldState.objCode

      let schema = 'com.nordstrom/workfront'
      let updates
      // The consumer will need to tinker with the OPTASK schema, which is a bit unfortunate.  Otherwise, we'll need to have the consumer have one method handle all event types.
      if (eventData.eventType === 'DELETE') {
        schema = `${schema}/${eventData.oldState.objCode}/DELETE/${eventData.oldState.categoryID}/1-0-0`

        eventData.oldState.schema = schema

        updates = eventData.oldState
      } else {
        schema = `${schema}/UPDATE-${eventData.oldState.objCode}/${eventData.oldState.categoryID}/1-0-0`

        delete eventData.oldState.ID
        delete eventData.oldState.objCode
        delete eventData.newState.ID
        delete eventData.newState.objCode

        updates = {
          schema,
          ID: keyId,
          objCode,
          oldState: eventData.oldState,
          newState: eventData.newState,
        }
      }
      console.log('constructed origin and schema for payload fields', origin, schema) // TODO remove

      const kinesis = new aws.Kinesis()
      const newEvent = {
        Data: JSON.stringify({
          schema: 'com.nordstrom/workfront/stream-ingress/1-0-0', // see ./schemas/stream-ingress in the workfront-subscriptions node module for reference
          timeOrigin: received, // TODO flag and handle re-try by looking at Workfront timestamp and received timestamp.  Use Workfront timestamp instead here.
          data: updates,
          origin,
        }),
        PartitionKey: keyId,
        StreamName: process.env.STREAM_NAME,
      }

      kinesis.putRecord(newEvent, (err, data) => {
        if (err) {
          callback(null, impl.kinesisError(eventData.newState.schema, err))
        } else {
          callback(null, impl.success(data))
        }
      })
    }
  },
}

const api = {
  /**
   * @param event The API Gateway lambda invocation event describing the event to be written to the stream.
   * @param context AWS runtime related information, e.g. log group id, timeout, request id, etc.
   * @param callback The callback to inform of completion: (error, result).
   */
  eventHandler: (event, context, callback) => {
    impl.validateAndWriteKinesisEventFromApiEndpoint(event, callback) // TODO could something from the context be useful for making a traceId?
  },
}

module.exports = {
  eventHandler: api.eventHandler,
}

