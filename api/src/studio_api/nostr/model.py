"""Core NIP-01 wire types: the Nostr event and the subscription filter."""

from typing import TypedDict

from pydantic import BaseModel, Field

Tag = list[str]


class NostrEvent(TypedDict):
    id: str
    pubkey: str
    created_at: int
    kind: int
    tags: list[Tag]
    content: str
    sig: str


class Filter(BaseModel):
    """One NIP-01 filter. All present fields are ANDed together."""

    ids: list[str] | None = None
    authors: list[str] | None = None
    kinds: list[int] | None = None
    since: int | None = None
    until: int | None = None
    limit: int | None = None
    tags: dict[str, list[str]] = Field(default_factory=dict)
    """Single-letter tag filters, e.g. {"e": [...], "p": [...]} for `#e`/`#p`."""
