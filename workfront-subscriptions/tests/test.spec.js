const assert = require('chai').assert
const proxyquire = require('proxyquire')

const TEST_API_KEY = 'TEST_API_KEY'
const TEST_SUBSCRIPTION_URL = 'TEST_SUBSCRIPTION_URL'
const TEST_SUBSCRIPTION_ID = 'TEST_SUBSCRIPTION_ID'
const TEST_OBJ_CODE = 'TEST_OBJ_CODE'
const TEST_OBJ_ID = 'TEST_OBJ_ID'
const TEST_EVENT_TYPE = 'TEST_EVENT_TYPE'
const TEST_URL = 'TEST_URL'
const TEST_AUTH_TOKEN = 'TEST_AUTH_TOKEN'

const workfrontSubscriptions = proxyquire('./index.js', {
  'node-fetch': (url, options) => ({ url, options }),
})(TEST_API_KEY, TEST_SUBSCRIPTION_URL)

describe('Workfront Subscriptions', function() {
  describe('subscribing to events', function() {
    it('subscribes to an object', function() {
      assert.deepEqual(
        workfrontSubscriptions.subscribeToEvent(
          TEST_OBJ_CODE,
          TEST_OBJ_ID,
          TEST_EVENT_TYPE,
          TEST_URL,
          TEST_AUTH_TOKEN
        ),
        {
          url: `${TEST_SUBSCRIPTION_URL}`,
          options: {
            method: 'POST',
            body: JSON.stringify({
              objCode: TEST_OBJ_CODE,
              objId: TEST_OBJ_ID,
              eventType: TEST_EVENT_TYPE,
              url: TEST_URL,
              authToken: TEST_AUTH_TOKEN
            }),
            headers: {
              Authorization: TEST_API_KEY,
              'Content-Type': 'application/json',
            },
          },
        })
    })
  })

  describe('deleting subscriptions', function() {
    it('deletes the requested subscription', function() {
      assert.deepEqual(
        workfrontSubscriptions.deleteSubscription(TEST_SUBSCRIPTION_ID),
        {
          url: `${TEST_SUBSCRIPTION_URL}/${TEST_SUBSCRIPTION_ID}`,
          options: {
            method: 'DELETE',
            headers: { Authorization: TEST_API_KEY },
          },
        })
    })
  })
})
