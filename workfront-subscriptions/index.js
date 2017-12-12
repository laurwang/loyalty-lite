const fetch = require('node-fetch')
const envelopeSchema = require('./schemas/subscription-event.json')
const streamEgressSchema = require('./schemas/stream-egress.json')

// NB OPTASK schema needs to be ok with more nulls; e.g., email issues don't use all the fields that store events does.
// TODO these schemas all need some investigation
const wfSchemas = {
  OPTASK: require('./schemas/OPTASK.json'), // eslint-disable-line global-require
  TASK: require('./schemas/TASK.json'), // eslint-disable-line global-require
  UPDATE: {
    OPTASK: require('./schemas/UPDATE-OPTASK.json'), // eslint-disable-line global-require
  },
  // TODO add the rest
}

// all available Workfront possibilities
const WF_CONSTANTS = {
  objCodes: ['USER', 'PORT', 'PRGM', 'PROJ', 'TASK', 'OPTASK', 'TMPL', 'PTLSEC', 'PTLTAB', 'CMPY', 'DOCU', 'NOTE'],
  eventTypes: ['CREATE', 'DELETE', 'UPDATE', 'SHARE'],
}

const impl = (apiKey, subscriptionsURL, subscribedPairs) => {
  const objCodes = []
  const eventTypes = []
  const pairs = []

  if (typeof subscribedPairs === 'string') {
    const candidates = subscribedPairs.split('|')
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i].split('-')
      if (cand.length === 2 && WF_CONSTANTS.objCodes.indexOf(cand[0]) > -1 && wfSchemas[cand[0]] && WF_CONSTANTS.eventTypes.indexOf(cand[1]) > -1) {
        if (objCodes.indexOf(cand[0]) === -1) {
          objCodes.push(cand[0])
        }
        if (eventTypes.indexOf(cand[1]) === -1) {
          eventTypes.push(cand[1])
        }
        if (pairs.indexOf(candidates[i]) === -1) {
          pairs.push(candidates[i])
        }
      } else {
        console.log(`WARNING: pair ${candidates[i]} does not have the correct format.  Skipping.  Workfront Subscription handler will not handle this pair.`)
      }
    }
  }

  const composeMessage =
    (objCode, objId, eventType, url, authToken) => {
      if (objId) {
        return JSON.stringify({ objCode, objId, eventType, url, authToken })
      } else {
        return JSON.stringify({ objCode, eventType, url, authToken })
      }
    }

  const subscribeToEvent = (objCode, objId, eventType, url, authToken) => {
    const options = {
      method: 'POST',
      body: composeMessage(objCode, objId, eventType, url, authToken),
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
    }

    return fetch(subscriptionsURL, options)
  }

  const deleteSubscription = (subscriptionId) => {
    const options = {
      method: 'DELETE',
      headers: { Authorization: apiKey },
    }

    return fetch(`${subscriptionsURL}/${subscriptionId}`, options)
  }

  const getAllSubscriptions = () => {
    const options = {
      method: 'GET',
      headers: { Authorization: apiKey },
    }

    return fetch(`${subscriptionsURL}/list`, options)
  }

  const getPayloadSchema = (objCode) => {
    if (objCode && objCodes.indexOf(objCode) > -1) {
      return wfSchemas[objCode]
    } else {
      return null
    }
  }

  const getUpdatePayloadSchema = (objCode, eventType) => {
    if (objCode && objCodes.indexOf(objCode) > -1 && eventType && eventTypes.indexOf(eventType)) {
      return wfSchemas[eventType][objCode]
    } else {
      return null
    }
  }

  const getEnvelopeSchema = () => envelopeSchema

  const getStreamSchema = () => streamEgressSchema

  const getObjCodes = () => objCodes

  const getEventTypes = () => eventTypes

  const getObjEventPairs = () => pairs

  return {
    subscribeToEvent,
    deleteSubscription,
    getAllSubscriptions,
    getPayloadSchema,
    getUpdatePayloadSchema,
    getEnvelopeSchema,
    getStreamSchema,
    getObjCodes,
    getEventTypes,
    getObjEventPairs,
  }
}

module.exports = impl
