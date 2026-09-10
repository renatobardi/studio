"""RED: the walking skeleton must run against a real MinIO, not just an idle
sidecar (ticket #9's acceptance criteria). This is infrastructure proof for
the Compose stack, not the Attachment feature — the real media API and its
client come in a later ticket.
"""

import os
import uuid

import boto3
from botocore.client import Config
from mypy_boto3_s3.client import S3Client

MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://localhost:9010")
MINIO_ROOT_USER = os.environ.get("MINIO_ROOT_USER", "studio")
MINIO_ROOT_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "devpassword")


def _s3_client() -> S3Client:
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ROOT_USER,
        aws_secret_access_key=MINIO_ROOT_PASSWORD,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def test_can_round_trip_an_object_through_a_real_minio() -> None:
    client = _s3_client()
    bucket = f"test-{uuid.uuid4().hex}"
    key = "hello.txt"
    body = b"hello from the walking skeleton"

    client.create_bucket(Bucket=bucket)
    try:
        client.put_object(Bucket=bucket, Key=key, Body=body)
        fetched = client.get_object(Bucket=bucket, Key=key)["Body"].read()

        assert fetched == body
    finally:
        client.delete_object(Bucket=bucket, Key=key)
        client.delete_bucket(Bucket=bucket)
