import boto3
import os
from uuid import uuid4
from werkzeug.utils import secure_filename
from extensions.uploads import allowed_file

def _get_s3():
    access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    bucket = os.environ.get("S3_BUCKET_NAME")
    region = os.environ.get("AWS_REGION", "us-east-1")
    if not all([access_key, secret_key, bucket]):
        return None, None
    client = boto3.client(
        "s3",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
    )
    return client, bucket


def upload_file_to_s3(files):
    client, bucket = _get_s3()
    if not client or not bucket:
        raise RuntimeError("S3 not configured (missing AWS keys or bucket name).")

    urls = []
    for file in files:
        if file and allowed_file(file.filename):
            # Make filename unique to avoid collisions.
            filename = f"{uuid4().hex}_{secure_filename(file.filename)}"
            client.upload_fileobj(
                file,
                bucket,
                filename,
                ExtraArgs={
                    'ContentType': file.content_type
                }
            )
            urls.append(f"https://{bucket}.s3.amazonaws.com/{filename}")
    return urls
