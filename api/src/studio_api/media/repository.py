"""The media repository: blob metadata and which Channels reference each
blob — shares its SurrealDB connection with the EventStore/ControlPlaneRepository
(same namespace/database, different tables), like the rest of the app.
"""

from typing import Any

from surrealdb.data.types.record_id import RecordID
from surrealdb.errors import NotFoundError

from studio_api.media.imeta import imeta_sha256s
from studio_api.media.models import Blob
from studio_api.nostr.model import NostrEvent


async def _select_or_none(db: Any, record_id: RecordID) -> dict[str, Any] | None:
    try:
        rows = await db.select(record_id)
    except NotFoundError:
        return None
    return rows[0] if rows else None


async def _query_or_empty(db: Any, surql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        rows: list[dict[str, Any]] = await db.query(surql, params)
    except NotFoundError:
        return []
    return rows


class MediaRepository:
    def __init__(self, db: Any) -> None:
        self._db = db

    async def create_blob(
        self, *, sha256: str, pubkey: str, mime: str, size: int, storage_key: str
    ) -> Blob:
        row = {"pubkey": pubkey, "mime": mime, "size": size, "storage_key": storage_key}
        await self._db.upsert(RecordID("blob", sha256), row)
        return Blob(sha256=sha256, pubkey=pubkey, mime=mime, size=size, storage_key=storage_key)

    async def get_blob(self, sha256: str) -> Blob | None:
        row = await _select_or_none(self._db, RecordID("blob", sha256))
        if row is None:
            return None
        return Blob(
            sha256=sha256,
            pubkey=row["pubkey"],
            mime=row["mime"],
            size=row["size"],
            storage_key=row["storage_key"],
        )

    async def channels_referencing(self, sha256: str) -> list[str]:
        rows = await _query_or_empty(
            self._db, "SELECT * FROM blob_channel_ref WHERE sha256 = $sha256", {"sha256": sha256}
        )
        return [r["channel_id"] for r in rows]

    async def record_references(self, event: NostrEvent, *, channel_id: str) -> None:
        """Records that `channel_id` references each blob the event's
        `imeta` tags point to. A reference to an unknown blob is silently
        skipped — the event itself was already accepted."""
        for sha256 in imeta_sha256s(event):
            if await self.get_blob(sha256) is None:
                continue
            ref_id = f"{sha256}:{channel_id}"
            await self._db.upsert(
                RecordID("blob_channel_ref", ref_id),
                {"sha256": sha256, "channel_id": channel_id},
            )
