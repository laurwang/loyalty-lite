const fetch = require('node-fetch')

const impl = (apiKey, subscriptionsURL) => {
  const composeMessage =
    (objCode, objId, eventType, url, authToken) =>
      JSON.stringify({ objCode, objId, eventType, url, authToken })

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

  return {
    subscribeToEvent,
    deleteSubscription,
  }
}

module.exports = impl
