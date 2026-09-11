"""RED: the object storage wrapper, against a real MinIO (ticket #9's
walking skeleton, not a mock — see test_minio_connectivity.py)."""

import os
import uuid

import pytest

from studio_api.media.storage import ObjectStorage

MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://localhost:9010")
MINIO_ROOT_USER = os.environ.get("MINIO_ROOT_USER", "studio")
MINIO_ROOT_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "devpassword")


@pytest.fixture
async def storage() -> ObjectStorage:
    bucket = f"test-{uuid.uuid4().hex}"
    store = ObjectStorage(
        endpoint_url=MINIO_ENDPOINT,
        access_key=MINIO_ROOT_USER,
        secret_key=MINIO_ROOT_PASSWORD,
        bucket=bucket,
    )
    await store.ensure_bucket()
    return store


async def test_ensure_bucket_is_idempotent(storage: ObjectStorage) -> None:
    await storage.ensure_bucket()
    await storage.ensure_bucket()


async def test_put_then_fetch_via_presigned_url_round_trips(storage: ObjectStorage) -> None:
    import httpx

    await storage.put_object("hello.txt", b"hello blossom", content_type="text/plain")

    url = await storage.presigned_get_url("hello.txt", expires_in=60)
    async with httpx.AsyncClient() as client:
        response = await client.get(url)

    assert response.status_code == 200
    assert response.content == b"hello blossom"
