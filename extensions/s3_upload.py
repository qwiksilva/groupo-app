import boto3
import os
from werkzeug.utils import secure_filename
from flask import current_app
from dotenv import load_dotenv

from extensions.uploads import allowed_file

load_dotenv()

print('AWS_ACCESS_KEY_ID' in os.environ)

s3 = boto3.client(
    's3',
    aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    region_name=os.environ.get('AWS_REGION', 'us-east-1')
)

BUCKET_NAME = os.environ['S3_BUCKET_NAME']

def upload_file_to_s3(files):
    urls = []
    for file in files:
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            s3.upload_fileobj(
                file,
                BUCKET_NAME,
                filename,
                ExtraArgs={
                    'ContentType': file.content_type
                }
            )
            urls.append(f"https://{BUCKET_NAME}.s3.amazonaws.com/{filename}")
    return urls