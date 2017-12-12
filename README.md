# Workfront Event Source

Event ingestion via Workfront [Event Subscription API](https://support.workfront.com/hc/en-us/articles/115000135574-Event-Subscription-API) to an AWS Kinesis stream.
Subscribes to all Workfront events for all objIds within a given objCode-eventType pair.

Notes
    Create an S3 bucket for your deployments called workfront-event-source.serverless.deployment-bucket.<AWS account region>.
    The provided Workfront schemas in the workfront-subscriptions module are just examples and are *highly preliminary*, and probably too restrictive.  Apart from the required fields, you may want to loosen up the fields, as needed.
