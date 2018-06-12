// const querystring = require('querystring')
// const uuidv4 = require('uuid/v4')
// const qrcode = require('qrcode')
const crypto = require('crypto')
const fetch = require('node-fetch')
const stream = require('stream')
const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies
const BbPromise = require('bluebird')
const Twilio = require('twilio')
const AJV = require('ajv')
const SCHEMAS = require('loyalty-lite-schemas')

fetch.Promise = BbPromise

/**
 * AWS
 */
aws.config.setPromisesDependency(BbPromise)
const dynamo = new aws.DynamoDB.DocumentClient()
// const kms = new aws.KMS()
const s3 = new aws.S3()

/**
 * Twilio
 */
const MessagingResponse = Twilio.twiml.MessagingResponse
// const twilio = {
//   accSid: process.env.TWILIO_ACC,
//   authToken: process.env.TWILIO_AUTH,
//   phone: process.env.TWILIO_PHONE,
//   boilerplate: 'Sent from your Twilio trial account - ',
// }

const Transform = stream.Transform

const llSchemas = SCHEMAS()

const ajv = new AJV()
const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`
const twilioIncomingRequest = llSchemas.getLoyaltyLiteSchema('twilioIncomingRequest')
const twilioIncomingRequestId = makeSchemaId(twilioIncomingRequest)
ajv.addSchema(twilioIncomingRequest, twilioIncomingRequestId)

const constants = {
  INVALID_REQUEST: 'Invalid Request: could not validate request to the schema provided.',
  KINESIS_INTEGRATION_ERROR: 'Kinesis Integration Error',
  DYNAMO_INTEGRATION_ERROR: 'DynamoDB Integration Error',
  S3_INTEGRATION_ERROR: 'S3 Integration Error',
  AWS_S3_URL: 'https://s3.amazonaws.com',

  SERVICE: process.env.PROJECT_NAME,
  STAGE: process.env.STAGE,
  API_NAME: 'Event Handler',
  SALT: process.env.SALT,
  UPGRADE_URL: process.env.UPGRADE_URL,
  TABLE_NAME: 'KnownPhone',
  BARCODE_SERVICE_URL: process.env.BARCODE_SERVICE_URL,
  BARCODE_SERVICE_KEY: process.env.BARCODE_SERVICE_KEY,
  FREE_BARCODE_GENERATOR: process.env.FREE_BARCODE_GENERATOR,

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
class DynamoError extends Error {
  constructor(message) {
    super(message)
    this.name = constants.DYNAMO_INTEGRATION_ERROR
  }
}
class S3Error extends Error {
  constructor(message) {
    super(message)
    this.name = constants.S3_INTEGRATION_ERROR
  }
}

const util = {
  twilioParse: (event) => {
    const manualParsing = event.body.split('&').map((el) => {
      const row = el.split('=')
      return {
        field: row[0],
        value: row[1],
      }
    })
    const body = {}
    manualParsing.forEach((el) => {
      body[el.field] = el.value.startsWith('%2B') ? `+${el.value.substring(3)}` : el.value
    })
    return body
  },

  response: (statusCode, body) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*', // Required for CORS support to work
      'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
    },
    body,
  }),
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
    const body = util.twilioParse(event)
    // const body = querystring.parse(event.body) // Some bug in node but not on command line
    /* if (!Twilio.validateRequest(twilio.authToken, event.headers['X-Twilio-Signature'], constants.ENDPOINT, body)) {
      return BbPromise.reject(new ClientError(`Twilio message signature validation failure. Event: '${JSON.stringify(event)}'`))
    } else */if (!body.From) {
      return BbPromise.reject(new ClientError(`Request from Twilio did not contain the sender phone number. Event: '${JSON.stringify(event)}'`))
    } else if (!body.Body) {
      return BbPromise.reject(new ClientError(`Request from Twilio did not contain the sender message. Event: '${JSON.stringify(event)}'`))
    } else {
      return BbPromise.resolve({
        // event,
        body,
      })
    }
  },

  /**
   * Handle customer request from code
   */
  checkForExistingPunchcard: (result) => {
    const hmac = crypto.createHmac('sha256', `${constants.SALT}`)
    const phone = result.body.From.substring(1) // get rid of '+'
    hmac.update(phone)
    const hashed = hmac.digest('hex').substring(0, 28)
    console.log(hashed)

    const trimmed = result.body.Body.trim().toLowerCase()

    if (trimmed === 'more') {
      // shameless plug
      return BbPromise.resolve({
        bypass: `Visit our website ${constants.UPGRADE_URL} to upgrade by entering your phone number.  As soon as we implement this.`,
      })
    } else if (trimmed === 'card') {
      const params = {
        TableName: `${constants.STAGE}-${constants.TABLE_NAME}`,
        Key: {
          phoneHash: hashed,
        },
      }

      return dynamo.get(params).promise().then(
        data => BbPromise.resolve({
          original: phone, // TODO remove after wiring up to GetNewBarcode
          phoneHash: hashed,
          url: data && data.Item ? `${data.Item.url}` : null,
        }),
        ex => BbPromise.reject(new DynamoError(`Error getting url: ${ex}`)) // eslint-disable-line comma-dangle
      )

      // Generating qr codes and/or barcodes
      // const serialNumber = uuidv4() // e.g., '416ac246-e7ac-49ff-93b4-f7e94d997e6b' // TODO remove serialNumber references

      // return BbPromise.resolve({
      //   from: hashed,
      //   url: `https://test.openapi.starbucks.com/v1/barcode/starbuckscard/12345${phone}`, // TODO soooo remove this.  Has PII.
      //   serialNumber, // TODO remove serialNumber references
      // })
    } else {
      return BbPromise.resolve({
        bypass: 'Please text a valid code: CARD or MORE.', // , FORGET, HELP', // TODO implement FORGET and BALANCE
      })
    }
  },

  // /**
  //  * Generate a QR Code and place the obtained image into the proper location of the bucket for
  //  * collection by Twilio.
  //  * @param results The hashed phone and campaign serial number and the url for the QRcode with that info.
  //  */
  // generateAndStoreQRImage: (results) => {
  //   if (results.bypass || results.url) {
  //     return BbPromise.resolve(results)
  //   }

  //   const phone = results.from
  //   const serialNumber = results.serialNumber
  //   const toQR = JSON.stringify({
  //     hashed: phone,
  //     card: serialNumber,
  //   })

  //   // create Writable and Readable Stream
  //   const inoutStream = new Transform({
  //     transform(chunk, encoding, callback) {
  //       this.push(chunk)
  //       callback()
  //     },
  //   })
  //   inoutStream.on('finish', () => { // TODO remove
  //     console.log(`QR Code generated for ${toQR}`)
  //   })

  //   qrcode.toFileStream(inoutStream, toQR) // stream is Writable

  //   const bucketKey = `${constants.STAGE}/qrc/${phone}/${serialNumber}.png`
  //   const params = {
  //     Bucket: constants.IMAGE_BUCKET,
  //     Key: bucketKey,
  //     Body: inoutStream, // stream is Readable
  //     ACL: 'public-read',
  //     ContentType: 'image/png',
  //     // Metadata: {
  //     //   serialNumber: serialNumber,
  //     // },
  //   }

  //   // NB putObject won't work with a stream.  See https://stackoverflow.com/questions/38442512/difference-between-upload-and-putobject-for-uploading-a-file-to-s3
  //   return s3.upload(params).promise().then(
  //     () => BbPromise.resolve({
  //       message: toQR,
  //       url: `${constants.AWS_S3_URL}/${constants.IMAGE_BUCKET}/${bucketKey}`,
  //     }),
  //     ex => BbPromise.reject(new S3Error(`Error placing image stream: ${ex}`)) // eslint-disable-line comma-dangle
  //   )
  // },

  /**
   * Generate an account with a barcode of the svc backed by that account, by calling the GetNewBarcode service,
   * and place the obtained image into the proper location of the bucket for collection by Twilio.
   * @param results The url for the barcode image
   */
  generateAndStoreImage: (results) => { // TODO break this into generateImage and storeImage
    if (results.bypass || results.url) {
      return BbPromise.resolve(results)
    }

    const phoneHash = results.phoneHash

    // create Writable and Readable Stream
    const inoutStream = new Transform({
      transform(chunk, encoding, callback) {
        this.push(chunk)
        callback()
      },
    })
    inoutStream.on('finish', () => { // TODO remove
      console.log('Barcode generated.') // for ${results.original}`)
    })

    // return fetch(`https://test.openapi.starbucks.com/v1/barcode/starbuckscard/12345${results.original}`)
    // return fetch(`${constants.BARCODE_SERVICE_URL}?hash=${phoneHash}`, {
    return fetch(constants.BARCODE_SERVICE_URL,
      {
        method: 'POST',
        headers: {
          'x-api-key': constants.BARCODE_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: {
          hash: phoneHash,
        },
      })
      .then(res => res.json())
      .then((json) => {
        console.log(`Received ${JSON.stringify(json)}`)
        return fetch(`${constants.FREE_BARCODE_GENERATOR}/${json.card_number}`)
          .then((res) => {
            res.body.pipe(inoutStream) // stream is Writable

            const bucketKey = `${constants.STAGE}/bc/${phoneHash}.png`
            const params = {
              Bucket: constants.IMAGE_BUCKET,
              Key: bucketKey,
              Body: inoutStream, // stream is Readable
              ACL: 'public-read',
              ContentType: 'image/png',
              // Metadata: {
              //   serialNumber: serialNumber,
              // },
            }

            // NB putObject won't work with a stream.  See https://stackoverflow.com/questions/38442512/difference-between-upload-and-putobject-for-uploading-a-file-to-s3
            return s3.upload(params).promise().then(
              () => BbPromise.resolve({
                phoneHash,
                url: `${constants.AWS_S3_URL}/${constants.IMAGE_BUCKET}/${bucketKey}`,
              }),
              ex => BbPromise.reject(new S3Error(`Error placing image stream: ${ex}`)) // eslint-disable-line comma-dangle
            )
          })
          .then((data) => {
            const params = {
              TableName: `${constants.STAGE}-${constants.TABLE_NAME}`,
              Item: data,
            }

            return dynamo.put(params).promise().then(
              () => BbPromise.resolve({
                message: 'Welcome to easy coffee perks.',
                url: data.url,
              }),
              ex => BbPromise.reject(new DynamoError(`Error putting url: ${ex}`)) // eslint-disable-line comma-dangle
            )
          })
      })
  },

  sendCards: (results) => {
    const response = new MessagingResponse()
    const message = response.message()

    if (results.bypass) {
      message.body(results.bypass)
    } else {
      // console.log(JSON.stringify(results)) // TODO remove
      message.body('Text MORE for information on how to earn free coffees twice as fast.')
      message.body(results.message) // TODO remove
      message.media(results.url) // how do i give them multiple?  probably multiple calls to .media
    }

    return response.toString()
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
  //         timeOrigin: received,
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
      .then(impl.checkForExistingPunchcard)
      .then(impl.generateAndStoreImage)
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
      .catch(S3Error, (ex) => {
        console.log(`${constants.SERVICE} ${constants.API_NAME} - ${ex.stack}`)
        callback(null, util.response(500, `${ex.name}: ${ex.message}`))
      })
      .catch(DynamoError, (ex) => {
        console.log(`${constants.SERVICE} ${constants.API_NAME} - ${ex.stack}`)
        callback(null, util.response(500, `${ex.name}: ${ex.message}`))
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

