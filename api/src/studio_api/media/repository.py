"""The media repository: blob metadata, which Channels reference each blob
and who a Direct Message blob was uploaded for — shares its SurrealDB
connection with the EventStore/ControlPlaneRepository (same namespace/
database, different tables), like the rest of the app.
"""

from typing import Any, Protocol

from surrealdb.data.types.record_id import RecordID

from studio_api.db import query_or_empty, select_or_none
from studio_api.media.imeta import imeta_sha256s
from studio_api.media.models import Blob
from studio_api.nostr.model import NostrEvent


class ChannelMembership(Protocol):
    """The slice of the control plane a blob's ACL depends on. Implemented
    by ControlPlaneRepository."""

    async def is_channel_member(self, channel_id: str, pubkey: str) -> bool: ...


class MediaRepository:
    def __init__(self, db: Any, *, authorizer: ChannelMembership) -> None:
        self._db = db
        self._authorizer = authorizer

    async def create_blob(
        self, *, sha256: str, pubkey: str, mime: str, size: int, storage_key: str
    ) -> Blob:
        row = {"pubkey": pubkey, "mime": mime, "size": size, "storage_key": storage_key}
        await self._db.upsert(RecordID("blob", sha256), row)
        return Blob(sha256=sha256, pubkey=pubkey, mime=mime, size=size, storage_key=storage_key)

    async def get_blob(self, sha256: str) -> Blob | None:
        row = await select_or_none(self._db, RecordID("blob", sha256))
        if row is None:
            return None
        return Blob(
            sha256=sha256,
            pubkey=row["pubkey"],
            mime=row["mime"],
            size=row["size"],
            storage_key=row["storage_key"],
        )

    async def can_read(self, sha256: str, pubkey: str) -> bool:
        """Whether this pubkey has a right to the blob's bytes: it uploaded
        it, it was named as a recipient when it was uploaded, or it belongs
        to a Channel that already references it. The single answer to that
        question (ticket #38) — a GET is authorized by it, and so is every
        new reference, which is why naming a hash cannot widen an ACL."""
        blob = await self.get_blob(sha256)
        if blob is None:
            return False
        if blob.pubkey == pubkey:
            return True
        if pubkey in await self.dm_recipients(sha256):
            return True
        for channel_id in await self.channels_referencing(sha256):
            if await self._authorizer.is_channel_member(channel_id, pubkey):
                return True
        return False

    async def channels_referencing(self, sha256: str) -> list[str]:
        rows = await query_or_empty(
            self._db, "SELECT * FROM blob_channel_ref WHERE sha256 = $sha256", {"sha256": sha256}
        )
        return [r["channel_id"] for r in rows]

    async def record_references(self, event: NostrEvent, *, channel_id: str) -> None:
        """Records that `channel_id` references each blob the event's
        `imeta` tags point to — but only those its author could already
        read. A reference to an unknown blob, or to one the author has no
        right to, is silently skipped and grants nothing; the event itself
        was already accepted, and each blob is decided on its own, so a
        rejected reference leaves no partial ACL behind."""
        for sha256 in imeta_sha256s(event):
            if not await self.can_read(sha256, event["pubkey"]):
                continue
            ref_id = f"{sha256}:{channel_id}"
            await self._db.upsert(
                RecordID("blob_channel_ref", ref_id),
                {"sha256": sha256, "channel_id": channel_id},
            )

    async def dm_recipients(self, sha256: str) -> list[str]:
        rows = await query_or_empty(
            self._db,
            "SELECT * FROM blob_dm_recipient WHERE sha256 = $sha256",
            {"sha256": sha256},
        )
        return [r["pubkey"] for r in rows]

    async def record_dm_recipients(self, *, sha256: str, pubkeys: list[str]) -> None:
        """Records who may fetch a Direct Message photo (ticket #7). Written
        from the uploader's own signed upload authorization, never from a
        gift wrap's tags: the envelope is relayed, mutable input, and the
        server cannot read the rumor that legitimately names the blob.

        This is a different table from the `blob_dm_ref` rows the relay used
        to write from those tags: every one of them was granted without ever
        checking the sender's right to the blob, so none of them is carried
        over — they are left behind, unread, rather than migrated."""
        for pubkey in pubkeys:
            ref_id = f"{sha256}:{pubkey}"
            await self._db.upsert(
                RecordID("blob_dm_recipient", ref_id),
                {"sha256": sha256, "pubkey": pubkey},
            )
