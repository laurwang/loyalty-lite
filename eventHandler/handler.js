const url = require('url')
const uuidv4 = require('uuid/v4')
// const qrcode = require('qrcode')

const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies
const BbPromise = require('bluebird')
/**
 * AWS
 */
aws.config.setPromisesDependency(BbPromise)
// const dynamo = new aws.DynamoDB.DocumentClient()
// const kms = new aws.KMS()
// const s3 = new aws.S3()

const Twilio = require('twilio')
/**
 * Twilio
 */
const twilio = {
  accSid: process.env.TWILIO_ACC,
  authToken: process.env.TWILIO_AUTH,
  phone: process.env.TWILIO_PHONE,
  url: process.env.TWILIO_URL,
  boilerplate: 'Sent from your Twilio trial account - ',
}

const SCHEMAS = require('loyalty-lite-schemas')

const llSchemas = SCHEMAS()

const AJV = require('ajv')

const ajv = new AJV()
const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`
const twilioIncomingRequest = llSchemas.getLoyaltyLiteSchema('twilioIncomingRequest')
const twilioIncomingRequestId = makeSchemaId(twilioIncomingRequest)
ajv.addSchema(twilioIncomingRequest, twilioIncomingRequestId)

const constants = {
  INVALID_REQUEST: 'Invalid Request: could not validate request to the schema provided.',
  KINESIS_INTEGRATION_ERROR: 'Kinesis Integration Error',
  S3_INTEGRATION_ERROR: 'S3 Integration Error',

  SERVICE: 'Loyalty Lite',
  API_NAME: 'Event Handler',

  ENDPOINT: process.env.ENDPOINT,
  IMAGE_BUCKET: process.env.IMAGE_BUCKET,
}

/**
 * Errors
 */
class ClientError extends Error {
  constructor(message) {
    super(message)
    this.name = constants.INVALID_REQUEST
  }
}
// class KinesisError extends Error {
//   constructor(message) {
//     super(message)
//     this.name = constants.KINESIS_INTEGRATION_ERROR
//   }
// }
// class S3Error extends Error {
//   constructor(message) {
//     super(message)
//     this.name = constants.S3_INTEGRATION_ERROR
//   }
// }

const util = {
  response: (statusCode, body) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*', // Required for CORS support to work
      'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
    },
    body,
  }),

  // kinesisError: (schemaName, err) => {
  //   console.log(err)
  //   return util.response(500, util.logMessage(constants.KINESIS_INTEGRATION_ERROR, `trying to write an event for '${JSON.stringify(schemaName)}'`))
  // },

  // S3Error: (phone, err) => {
  //   console.log(err)
  //   return util.response(500, util.logMessage(constants.S3_INTEGRATION_ERROR, `trying to write image stream for '${JSON.stringify(phone)}'`))
  // },

  // success: response => util.response(200, JSON.stringify(response)),
}

const impl = {
  /**
   * Validate that the given event validates against the request schema
   * @param event The event representing the HTTPS request from Twilio
   */
  validateApiGatewayRequest: (event) => {
    if (!ajv.validate(twilioIncomingRequestId, event)) { // bad request
      return BbPromise.reject(new ClientError(`Mismatch versus request schema: ${ajv.errorsText()}.  Event: '${JSON.stringify(event)}'`))
    } else {
      return BbPromise.resolve(event)
    }
  },

  /**
   * Validate the request as having a proper signature from Twilio.  This provides authentication that the request came from Twillio.
   * @param event The event representing the HTTPS request from Twilio
   */
  validateTwilioRequest: (event) => {
    console.log('from Twilio',`${event}`)
    const body = url.parse(`?${event.body}`, true).query
    console.log(`${body}`) // TODO remove
    if (!Twilio.validateRequest(twilio.authToken, event.headers['X-Twilio-Signature'], constants.ENDPOINT, body)) {
      return BbPromise.reject(new ClientError(`Twilio message signature validation failure. Event: '${JSON.stringify(event)}'`))
    } else if (!body.from) {
      return BbPromise.reject(new ClientError(`Request from Twilio did not contain the sender phone number. Event: '${JSON.stringify(event)}'`))
    } else if (!body.body) {
      return BbPromise.reject(new ClientError(`Request from Twilio did not contain the sender message. Event: '${JSON.stringify(event)}'`))
    } else {
      return BbPromise.resolve({
        // event,
        body,
      })
    }
  },

  // generateCards: (phone) => {
  //   const serialNumber = uuidv4()
  //   const stream
  //   // TODO see https://nodejs.org/api/stream.html#stream_event_pipe and
  //   //https://stackoverflow.com/questions/44335139/upload-a-file-stream-to-s3-without-a-file-and-from-memory
  //   return qrcode.toFileStream(stream, `${JSON.stringify({
  //     phone,
  //     serialNumber,
  //   })}`)
  // },

  /**
   * Handle customer request from code
   */
  generateCards: (body) => {
    const trimmed = body.body.substring(twilio.boilerplate.length).toLowerCase()
    if (trimmed === 'new') {
      return BbPromise.resolve({
        from: body.from,
        serialNumbers: [uuidv4()], // e.g., '416ac246-e7ac-49ff-93b4-f7e94d997e6b' // TODO call Campaign Manager
        images: null, // TODO make an actual QRCode using impl.generateCard and return a stream
      })
    } else if (trimmed === 'card') { // return all cards found
      // TODO make an actual QRCode using impl.generateCard and return a stream or array of streams
      return BbPromise.reject(new ClientError(`Request from customer asked for undeveloped feature. Body: '${JSON.stringify(body)}'`))
    } else {
      return BbPromise.reject(new ClientError(`Request from customer did not contain a valid code. Body: '${JSON.stringify(body)}'`))
    }
  },

  // /**
  //  * Using the results of the `impl.generateCards` invocation, place the obtained image into the
  //  * proper location of the bucket for collection by Twilio.
  //  * @param results An array of images obtained from `getQRCodes`.  Details:
  //  */
  // storeImages: (results) => {
  //   const from = results.from
  //   const serialNumbers = results.serialNumbers
  //   const images = results.images // TODO consume an array of streams

  //   const image = images[0] // TODO parallel write all as streams uploaded to S3

  //   const bucketKey = `i/p/${from}/0` // TODO parallel write all

  //   const params = {
  //     Bucket: constants.IMAGE_BUCKET,
  //     Key: bucketKey,
  //     Body: image.data,
  //     ContentType: image.contentType,
  //     Metadata: {
  //       serialNumber: image.serialNumber,
  //     },
  //   }
  //   return s3.putObject(params).promise().then(
  //     () => BbPromise.resolve({
  //       from,
  //       serialNumbers,
  //       images: [ `${constants.IMAGE_BUCKET}/${bucketKey}` ], // TODO multiple images
  //     }),
  //     ex => BbPromise.reject(new ServerError(`Error placing image into S3: ${ex}`)) // eslint-disable-line comma-dangle
  //   )
  // },

  sendCards: (results) => {
    const msg = new Twilio.TwimlResponse()
    msg.message(`${JSON.Stringify({
      from: results.from,
      serialNumbers: results.serialNumbers,
    })}`)

    // msg.body(`${JSON.Stringify({
    //   from: results.from,
    //   serialNumbers: results.serialNumbers,
    //   })}`)
    // msg.media(results.images) // how do i give them multiple?
    return msg.toString()
  },

  // writeKinesisEvent: (event, callback) => {
  //   const received = new Date().toISOString()
  //   const eventData = JSON.parse(event.body)
  //   console.log('Twilio Event', eventData)
  //     eventData.schema = `com.starbucks/event-ledger/stream-ingress/1-0-0`

  //     const kinesis = new aws.Kinesis()
  //     const newEvent = {
  //       Data: JSON.stringify({
  //         schema: 'com.starbucks/event-ledger/stream-ingress/1-0-0', // see ./schemas/stream-ingress in the workfront-subscriptions node module for reference
  //         timeOrigin: received, // TODO flag and handle re-try by looking at Workfront timestamp and received timestamp.  Use Workfront timestamp instead here.
  //         data: eventData.body,
  //         origin,
  //       }),
  //       PartitionKey: eventData.body.from,
  //       StreamName: process.env.STREAM_NAME,
  //     }

  //     kinesis.putRecord(newEvent, (err, data) => {
  //       if (err) {
  //         callback(null, impl.kinesisError(eventData.schema, err))
  //       } else {
  //         callback(null, impl.success(data))
  //       }
  //     })
  //   }
  // },
}

const api = {
  /**
   * @param event The API Gateway lambda invocation event describing the Twilio event to be processed.
   * @param context AWS runtime related information, e.g. log group id, timeout, request id, etc.
   * @param callback The callback to inform of completion: (error, result).
   */
  eventHandler: (event, context, callback) => {
    impl.validateApiGatewayRequest(event)
      .then(impl.validateTwilioRequest)
      .then(impl.generateCards)
      // .then(impl.storeImages)
      .then(impl.sendCards)
      .then((msg) => {
        const response = util.response(200, msg)
        response.headers['Content-Type'] = 'text/xml'
        callback(null, response)
      })
      .catch(ClientError, (ex) => {
        console.log(`${constants.SERVICE} ${constants.API_NAME} - ${ex.stack}`)
        callback(null, util.response(400, `${ex.name}: ${ex.message}`))
      })
      .catch((ex) => {
        console.log(`${constants.SERVICE} ${constants.API_NAME} - Uncaught exception: ${ex.stack}`)
        callback(null, util.response(500, 'Server Error'))
      })
  },
}

module.exports = {
  eventHandler: api.eventHandler,
}

