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
        self._access_key = access_key
        self._secret_key = secret_key
        self._client: S3Client = self._make_client(endpoint_url)

    def _make_client(self, endpoint_url: str) -> S3Client:
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
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

    async def presigned_get_url(self, key: str, *, expires_in: int, public_endpoint_url: str) -> str:
        """Presigns with a client pointed at `public_endpoint_url`, not the internal endpoint
        this instance connects with — the browser receiving this URL isn't on the Docker
        network, so it needs a host it can actually reach (see the Caddyfile's
        `/<bucket>/*` route, which proxies straight to MinIO with no path rewriting so the
        signature — computed over the path as boto3 built it — still validates there)."""

        def _presign() -> str:
            client = self._make_client(public_endpoint_url)
            return client.generate_presigned_url(
                "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=expires_in
            )

        return await asyncio.to_thread(_presign)
