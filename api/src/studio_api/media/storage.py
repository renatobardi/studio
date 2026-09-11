"""Object storage for uploaded blobs: an S3-compatible bucket (MinIO in dev/
CI, ticket #9's walking skeleton) behind a small async wrapper — boto3 is
synchronous, so every call runs off the event loop via `asyncio.to_thread`.
"""

import asyncio

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from mypy_boto3_s3.client import S3Client


class ObjectStorage:
    def __init__(self, *, endpoint_url: str, access_key: str, secret_key: str, bucket: str) -> None:
        self._bucket = bucket
        self._client: S3Client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )

    async def ensure_bucket(self) -> None:
        def _ensure() -> None:
            try:
                self._client.head_bucket(Bucket=self._bucket)
            except ClientError:
                self._client.create_bucket(Bucket=self._bucket)

        await asyncio.to_thread(_ensure)

    async def put_object(self, key: str, data: bytes, *, content_type: str) -> None:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def presigned_get_url(self, key: str, *, expires_in: int) -> str:
        return await asyncio.to_thread(
            self._client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )
