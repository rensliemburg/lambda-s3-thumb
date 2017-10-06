# aws-lambda-create-thumbnail
Automatically create thumbnails when image added to an AWS S3 bucket

Deploy to AWS Lambda by creating a zip file containing the contents of
this repo.

For callback on success, change config/default.json as appropriate
depending on which environment the zip file is being uploaded for.

Create in IAM a role for lambda function with policy AWSLambdaExecute providing
Put, get access to S3 bucket and access to CloudWatch Logs.

