import boto3
import os
from uuid import uuid4
from io import BytesIO
from botocore.config import Config
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
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(signature_version="s3v4"),
    )
    return client, bucket


def upload_file_to_s3(files):
    client, bucket = _get_s3()
    if not client or not bucket:
        raise RuntimeError("S3 not configured (missing AWS keys or bucket name).")
    region = os.environ.get("AWS_REGION", "us-east-1")

    urls = []
    expires = int(os.environ.get("S3_URL_EXPIRES", 60 * 60 * 24))  # default 24h

    for file in files:
        if file and allowed_file(file.filename):
            # Make filename unique to avoid collisions.
            filename = f"{uuid4().hex}_{secure_filename(file.filename)}"
            client.upload_fileobj(
                file,
                bucket,
                filename,
                ExtraArgs={
                    'ContentType': file.content_type or 'application/octet-stream',
                }
            )
            presigned = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": filename},
                ExpiresIn=expires,
            )
            print(f"[upload] presigned for bucket={bucket} region={region} key={filename}")
            print(f"[upload] url={presigned}")
            urls.append(presigned)
        else:
            if not file:
                print("[upload] skipped empty file object")
            elif not allowed_file(file.filename):
                print(f"[upload] skipped disallowed extension: {file.filename}")
    return urls


def upload_bytes_to_s3(items):
    client, bucket = _get_s3()
    if not client or not bucket:
        raise RuntimeError("S3 not configured (missing AWS keys or bucket name).")
    region = os.environ.get("AWS_REGION", "us-east-1")
    expires = int(os.environ.get("S3_URL_EXPIRES", 60 * 60 * 24))

    urls = []
    for item in items:
        data = item.get("data")
        filename = item.get("filename")
        if not data or not filename:
            continue
        if not allowed_file(filename):
            print(f"[upload] skipped disallowed extension: {filename}")
            continue
        client.upload_fileobj(
            BytesIO(data),
            bucket,
            filename,
            ExtraArgs={
                'ContentType': item.get("content_type") or 'application/octet-stream',
            }
        )
        presigned = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": filename},
            ExpiresIn=expires,
        )
        print(f"[upload] presigned for bucket={bucket} region={region} key={filename}")
        print(f"[upload] url={presigned}")
        urls.append(presigned)
    return urls
