"""Proves a restored Studio actually came back — issue #53. Run it inside the
api container of the *restored* stack:

    python -m studio_api.verify_restore

It reads the same env the app reads (`SURREAL_*`, `MINIO_*`,
`WORKSPACE_KEY_SECRET`), prints one JSON report and exits non-zero unless every
Workspace is sound. A restore that only brings rows back is not a restore: the
Workspace Key has to decrypt with the server secret recovered from the secret
manager and still match the `workspace` row, or the Workspace can never sign a
membership change again (ADR-0002). That check, the Messages, the memberships,
the Workspace-signed projections and the blob bytes are what the report is
evidence of.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from coincurve import PrivateKey

from studio_api.crypto_secrets import decrypt_secret
from studio_api.media.storage import ObjectStorage
from studio_api.nostr.crypto import has_valid_integrity
from studio_api.nostr.model import NostrEvent
from studio_api.nostr.projection import PROJECTION_KINDS
from studio_api.nostr.store import EventStore
from studio_api.nostr.validation import MESSAGE

BlobVerdict = str  # "intact" | "missing" | "corrupt"


@dataclass(frozen=True)
class WorkspaceEvidence:
    slug: str
    key_recovered: bool
    messages: int
    memberships: int
    projections: int
    unsigned_projections: tuple[str, ...]

    @property
    def ok(self) -> bool:
        """Nothing here demands a Workspace be busy: one nobody has spoken in
        yet has no Messages and no projections to lose. What it must have is a
        recoverable key, the members the control plane says it has, and not one
        projection that fails to verify against that key."""
        return self.key_recovered and self.memberships > 0 and not self.unsigned_projections


@dataclass(frozen=True)
class RestoreEvidence:
    workspaces: tuple[WorkspaceEvidence, ...]
    blobs: int
    missing_blobs: tuple[str, ...]
    corrupt_blobs: tuple[str, ...]

    @property
    def ok(self) -> bool:
        """Sound Workspaces are not enough on their own: a dump that silently
        restored nothing also has no unsigned projection in it. Somewhere on
        the server a Message and a projection have to have come back."""
        return (
            bool(self.workspaces)
            and all(workspace.ok for workspace in self.workspaces)
            and any(workspace.messages for workspace in self.workspaces)
            and any(workspace.projections for workspace in self.workspaces)
            and not self.missing_blobs
            and not self.corrupt_blobs
        )


def recover_key_pubkey(encrypted_key: bytes, *, server_secret: str) -> str | None:
    """The pubkey of the Workspace Key this blob holds, or None when the
    recovered server secret does not open it."""
    try:
        secret = decrypt_secret(encrypted_key, server_secret=server_secret)
        return PrivateKey(secret).public_key_xonly.format().hex()
    except Exception:  # noqa: BLE001 — a wrong secret or a damaged blob both mean "not recovered"
        return None


def audit_workspace(
    *,
    slug: str,
    key_pubkey: str,
    encrypted_key: bytes,
    events: Iterable[NostrEvent],
    memberships: int,
    server_secret: str,
) -> WorkspaceEvidence:
    messages = 0
    projections = 0
    unsigned: list[str] = []
    for event in events:
        if event["kind"] == MESSAGE:
            messages += 1
        elif event["kind"] in PROJECTION_KINDS:
            projections += 1
            if event["pubkey"] != key_pubkey or not has_valid_integrity(event):
                unsigned.append(event["id"])
    return WorkspaceEvidence(
        slug=slug,
        key_recovered=recover_key_pubkey(encrypted_key, server_secret=server_secret) == key_pubkey,
        messages=messages,
        memberships=memberships,
        projections=projections,
        unsigned_projections=tuple(unsigned),
    )


def classify_blob(sha256: str, content: bytes | None) -> BlobVerdict:
    if content is None:
        return "missing"
    return "intact" if hashlib.sha256(content).hexdigest() == sha256 else "corrupt"


def audit_blobs(
    rows: Iterable[tuple[str, bytes | None]],
) -> tuple[int, tuple[str, ...], tuple[str, ...]]:
    """Returns (rows seen, digests whose object is gone, digests whose bytes
    no longer hash to the row)."""
    blobs = 0
    missing: list[str] = []
    corrupt: list[str] = []
    for sha256, content in rows:
        blobs += 1
        verdict = classify_blob(sha256, content)
        if verdict == "missing":
            missing.append(sha256)
        elif verdict == "corrupt":
            corrupt.append(sha256)
    return blobs, tuple(missing), tuple(corrupt)


# --- Reading the restored stack ------------------------------------------


async def _rows(db: Any, surql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    result = await db.query(surql, params or {})
    return list(result) if result else []


async def collect_evidence(store: EventStore, storage: ObjectStorage, *, server_secret: str) -> RestoreEvidence:
    db = store.raw
    workspaces: list[WorkspaceEvidence] = []
    for row in await _rows(db, "SELECT *, meta::id(id) AS slug FROM workspace;"):
        slug = row["slug"]
        events = [
            {
                "id": event["event_id"],
                "pubkey": event["pubkey"],
                "created_at": event["created_at"],
                "kind": event["kind"],
                "tags": event["tags"],
                "content": event["content"],
                "sig": event["sig"],
            }
            for event in await _rows(
                db, "SELECT * FROM event WHERE workspace_slug = $slug;", {"slug": slug}
            )
        ]
        members = await _rows(
            db,
            "SELECT VALUE pubkey FROM workspace_member WHERE workspace_slug = $slug;",
            {"slug": slug},
        )
        workspaces.append(
            audit_workspace(
                slug=slug,
                key_pubkey=row["key_pubkey"],
                encrypted_key=bytes(row["encrypted_key"]),
                events=events,  # type: ignore[arg-type]
                memberships=len(members),
                server_secret=server_secret,
            )
        )

    blob_rows = await _rows(db, "SELECT *, meta::id(id) AS sha256 FROM blob;")
    fetched = [
        (row["sha256"], await storage.get_object(row["storage_key"])) for row in blob_rows
    ]
    blobs, missing, corrupt = audit_blobs(fetched)
    return RestoreEvidence(
        workspaces=tuple(workspaces), blobs=blobs, missing_blobs=missing, corrupt_blobs=corrupt
    )


async def _run() -> RestoreEvidence:
    store = await EventStore.connect(
        url=os.environ["SURREAL_URL"],
        namespace=os.environ.get("SURREAL_NAMESPACE", "studio"),
        database=os.environ.get("SURREAL_DATABASE", "studio"),
        user=os.environ["SURREAL_USER"],
        password=os.environ["SURREAL_PASS"],
    )
    storage = ObjectStorage(
        endpoint_url=os.environ["MINIO_ENDPOINT"],
        access_key=os.environ["MINIO_ROOT_USER"],
        secret_key=os.environ["MINIO_ROOT_PASSWORD"],
        bucket=os.environ.get("MINIO_BUCKET", "studio-media"),
    )
    try:
        return await collect_evidence(
            store, storage, server_secret=os.environ["WORKSPACE_KEY_SECRET"]
        )
    finally:
        await store.close()


def main() -> None:
    evidence = asyncio.run(_run())
    print(json.dumps({**asdict(evidence), "ok": evidence.ok}, indent=2))
    sys.exit(0 if evidence.ok else 1)


if __name__ == "__main__":
    main()
