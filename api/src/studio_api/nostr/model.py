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


def first_tag_value(event: NostrEvent, name: str) -> str | None:
    """The value of the first tag named `name` (e.g. `"relay"`, `"u"`), or
    `None` if the event has none."""
    for tag in event["tags"]:
        if len(tag) >= 2 and tag[0] == name:
            return tag[1]
    return None


def all_tag_values(event: NostrEvent, name: str) -> list[str]:
    """Every value of every tag named `name`, in order — e.g. the `x`
    (blob sha256) tags on a gift wrap."""
    return [tag[1] for tag in event["tags"] if len(tag) >= 2 and tag[0] == name]
