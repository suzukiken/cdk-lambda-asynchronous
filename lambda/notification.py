import os
import urllib.request
import json

def lambda_handler(event, context):

    print(event)

    url = os.environ.get('SLACK_WEBHOOK_URL')

    headers = {
        'Content-Type': 'application/json',
    }
    
    for record in event['Records']:
        
        data = None
        
        if record['eventSource'] == "aws:sqs":
            data = {
                'text': '{} {} {} {}'.format(
                    record['messageAttributes']['ErrorMessage']['stringValue'],
                    record['messageAttributes']['ErrorCode']['stringValue'],
                    record['eventSourceARN'],
                    record['body']
                )
            }

        if data:
            req = urllib.request.Request(url, headers=headers, data=json.dumps(data).encode('utf-8'), method='POST')
            f = urllib.request.urlopen(req)

            print(f.read().decode('utf-8'))
