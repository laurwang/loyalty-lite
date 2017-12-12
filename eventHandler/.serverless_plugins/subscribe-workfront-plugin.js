'use strict'

const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const spawnSync = require('child_process').spawnSync
const WF = require('workfront-subscriptions')

const EVENT_HANDLER_NAME = 'eventHandler'
const SERVICE_ENDPOINT = 'ServiceEndpoint: '

const secrets = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', 'private.yml'), 'utf8'))
const config = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', 'project.yml'), 'utf8'))
const wf = WF(secrets.WF.apiKey, secrets.WF.apiEndpoint, config.eventHandler.objCodeEventTypePairs)

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options

    this.hooks = {
      'after:deploy:deploy': this.subscribeEndpoint.bind(this),
      'before:remove:remove': this.unsubscribeEndpoint.bind(this),
    }

    this.getOwnUrl = this.getOwnUrl.bind(this)
    this.getSubscriptions = this.getSubscriptions.bind(this)
  }

  getOwnUrl() {
    // const process = spawnSync(`${__dirname}/../../node_modules/.bin/sls`, ['info', '-s', this.serverless.variables.service.custom.stage])
    const shellCommand = `../node_modules/.bin/sls info -v -s ${ this.serverless.variables.service.custom.stage} | grep ${SERVICE_ENDPOINT}`
    const process = spawnSync('sh', ['-c', shellCommand], { stdio: 'pipe' , cwd: `${__dirname}/..`})
    const stdout = process.stdout.toString()
    const stderr = process.stderr.toString()

    if(stderr) {
      this.serverless.cli.log(stderr)
    }

    if(stdout) {
      return stdout.substring(SERVICE_ENDPOINT.length).trim()
    }

    return null
  }

  // returns Promise resolving to an array of subscriptions for that url
  getSubscriptions(url) {
    return wf.getAllSubscriptions()
      .then((res) => {
        return res.json()
      })
      .then((json) => {
        const result = []
        for (let i = 0; i < json.length; i++) {
          const blob = json[i]
          if (blob.url === url) {
            result.push(blob)
          }
        }
        return result
      })
      .catch((err) => {
        this.serverless.cli.log('Error while retrieving subscriptions.')
        this.serverless.cli.log(JSON.stringify(err))
        this.serverless.cli.log('This may result in unwanted subscriptions.')
        return []
      })
  }

  subscribeEndpoint() {
    const serviceEndpoint = this.getOwnUrl()

    if (serviceEndpoint) {
      const endpointToSubscribe = `${serviceEndpoint}/${EVENT_HANDLER_NAME}`
      const pairs = wf.getObjEventPairs()

      this.serverless.cli.log(`Checking for existing subscriptions for ${endpointToSubscribe}.`)
      this.getSubscriptions(endpointToSubscribe)
        .then((res) => {
          for (let i = 0; i < res.length; i++) {
            const blob = res[i]
            const pairsIndex = pairs.indexOf(`${blob.objCode}-${blob.eventType}`)
            if (pairsIndex > -1) {
              this.serverless.cli.log(`Subscription for ${endpointToSubscribe} to Workfront ${blob.objCode}-${blob.eventType} events already exists.  Skipping.`)
              pairs.splice(pairsIndex, 1)
            }
          }

          // for each pair, run wf.subscribe
          const actions = []
          for (let i = 0; i < pairs.length; i++) {
            const toSubscribe = pairs[i].split('-')
            actions.push(
              wf.subscribeToEvent(toSubscribe[0], null, toSubscribe[1], endpointToSubscribe, secrets.AWS.authToken)
              .then((currRes) => {
                if (currRes.status < 300) {
                  this.serverless.cli.log(`Successfully subscribed to ${pairs[i]}.`)
                } else {
                  this.serverless.cli.log(`Subscription for ${pairs[i]} was unsuccessful, with status ${currRes.status}.`)
                  this.serverless.cli.log(JSON.stringify(currRes))
                }
              })
              .catch((err) => {
                this.serverless.cli.log(`Failure while subscribing to Workfront ${pairs[i]} events.`)
                this.serverless.cli.log(JSON.stringify(err))
              })
            )
          }

          this.serverless.cli.log(`Subscribing ${endpointToSubscribe} to remaining Workfront events, if any.`)
          Promise.all(actions)
        })
    } else {
      this.serverless.cli.log('No endpoint found.  No subscriptions attempted.')
    }
  }

  unsubscribeEndpoint() {
    const serviceEndpoint = this.getOwnUrl()

    if (serviceEndpoint) {
      const endpointToSubscribe = `${serviceEndpoint}/${EVENT_HANDLER_NAME}`

      this.serverless.cli.log(`Retrieving subscription ids for ${endpointToSubscribe}.`)
      this.getSubscriptions(endpointToSubscribe)
        .then((res) => {
          const subIds = res.map((blob) => {
            return blob.id
          })

          // for each subId, run wf.deleteSub
          const actions = []
          for (let i = 0; i < subIds.length; i++) {
            actions.push(
              wf.deleteSubscription(subIds[i])
                .then((currRes) => {
                  if (currRes.status < 300) {
                    this.serverless.cli.log(`Successfully unsubscribed ${subIds[i]}.`)
                  } else {
                    this.serverless.cli.log(`Subscription removal for ${subIds[i]} was unsuccessful, with status ${currRes.status}.`)
                    this.serverless.cli.log(JSON.stringify(currRes))
                  }
                })
                .catch((err) => {
                  this.serverless.cli.log(`Failure while unsubscribing from Workfront subscription ${subIds[i]}.`)
                  this.serverless.cli.log(JSON.stringify(err))
                })
            )
          }

          this.serverless.cli.log(`Unsubscribing ${endpointToSubscribe} from ${subIds.join(', ')}.`)
          Promise.all(actions)
        })
    } else {
      this.serverless.cli.log('No endpoint found.  No subscription removals attempted.')
    }
  }
}

module.exports = ServerlessPlugin
