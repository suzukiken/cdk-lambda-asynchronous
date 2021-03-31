import boto3
import json
from datetime import datetime

client = boto3.client('lambda')

dt = datetime.now().isoformat()

for i in range(20):
    response = client.invoke(
        FunctionName='cdklambdaasynchronous-main',
        InvocationType='Event',
        Payload=json.dumps({
            'datetime': dt,
            'count': i,
            #'waitsec': 1,
            'error': True
        })
    )
    
    print(response)