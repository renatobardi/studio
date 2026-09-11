"""Media domain objects — the blob descriptor returned by the upload
endpoint, and the server-private blob record backing it."""

from pydantic import BaseModel


class BlobDescriptor(BaseModel):
    url: str
    sha256: str
    size: int
    type: str


class Blob(BaseModel):
    sha256: str
    pubkey: str
    """The uploader — always allowed to fetch their own blob."""
    mime: str
    size: int
    storage_key: str
