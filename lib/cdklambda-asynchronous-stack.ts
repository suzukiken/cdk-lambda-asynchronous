import * as cdk from '@aws-cdk/core';
import * as sqs from "@aws-cdk/aws-sqs";
import * as ssm from "@aws-cdk/aws-ssm";
import * as lambda from "@aws-cdk/aws-lambda";
import { PythonFunction } from "@aws-cdk/aws-lambda-python";
import { SqsEventSource } from "@aws-cdk/aws-lambda-event-sources";

export class CdklambdaAsynchronousStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    const PREFIX_NAME = id.toLowerCase().replace("stack", "")
    const SLACK_WEBHOOK_URL = ssm.StringParameter.fromStringParameterName(this, "ssm_param_url", "slack-webhook-url").stringValue;
    
    // notification for dead letter queue
    
    const notification_function = new PythonFunction(this, "notification_function", {
      entry: "lambda",
      index: "notification.py",
      handler: "lambda_handler",
      functionName: PREFIX_NAME + "-notification",
      runtime: lambda.Runtime.PYTHON_3_8,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SLACK_WEBHOOK_URL: SLACK_WEBHOOK_URL
      }
    });
    
    // DLQ and its lambda which will be triggered by dlq
    
    const dead_letter_queue = new sqs.Queue(this, "dead_letter_queue", {
      queueName: PREFIX_NAME + "-dlq",
      retentionPeriod: cdk.Duration.minutes(60),
    });
    
    notification_function.addEventSource(
      new SqsEventSource(dead_letter_queue)
    );

    dead_letter_queue.grantConsumeMessages(notification_function);
    
    // the main function to be invoked
    
    const main_function = new PythonFunction(this, "main_function", {
      entry: "lambda",
      index: "main.py",
      handler: "lambda_handler",
      functionName: PREFIX_NAME + "-main",
      runtime: lambda.Runtime.PYTHON_3_8,
      timeout: cdk.Duration.seconds(3),
      reservedConcurrentExecutions: 1,
      retryAttempts: 0, // 0 - 2 
      maxEventAge: cdk.Duration.seconds(60), // 60, 180
      deadLetterQueue: dead_letter_queue
    });
    
    new cdk.CfnOutput(this, "output", { value: main_function.functionName })
  }
}



