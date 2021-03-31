import time

def lambda_handler(event, context):
    
    print(event)
    
    waitsec = event.get('waitsec', 0)
    
    if waitsec:
        time.sleep(waitsec)
    
    error = event.get('error', False)
    
    if error:
        raise Exception('On Purpose.')