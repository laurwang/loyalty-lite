const streamEgressSchema = require('./schemas/stream-egress.json')
const streamIngressSchema = require('./schemas/stream-ingress.json')

const loyaltyLiteSchemas = {
  cmRedeem: require('./schemas/cm-redeem.json'), // eslint-disable-line global-require
  twilioIncomingRequest: require('./schemas/twilio-incoming-request.json'), // eslint-disable-line global-require
  // TODO add the rest
}

const impl = () => {
  const getLoyaltyLiteSchemas = () => Object.keys(loyaltyLiteSchemas)

  // call by converting hy-phe-na-tion to camelCase
  const getLoyaltyLiteSchema = schemaName => loyaltyLiteSchemas[schemaName]

  const getStreamEgressSchema = () => streamEgressSchema
  const getStreamIngressSchema = () => streamIngressSchema

  return {
    getLoyaltyLiteSchemas,
    getLoyaltyLiteSchema,
    getStreamEgressSchema,
    getStreamIngressSchema,
  }
}

module.exports = impl
