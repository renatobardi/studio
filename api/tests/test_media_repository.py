"""RED: the media repository — blob metadata and channel references,
against a real SurrealDB (same store as ControlPlaneRepository's tests)."""

from studio_api.media.repository import MediaRepository
from studio_api.nostr.store import EventStore

SHA = "a" * 64
OTHER_SHA = "b" * 64


def _message_event(*, sha256: str, channel_id: str = "chan1") -> dict:
    return {
        "id": "evt1",
        "pubkey": "author",
        "created_at": 0,
        "kind": 9,
        "tags": [["h", channel_id], ["imeta", f"x {sha256}"]],
        "content": "",
        "sig": "sig",
    }


async def test_get_blob_before_creation_is_none(store: EventStore) -> None:
    repo = MediaRepository(store.raw)

    assert await repo.get_blob(SHA) is None


async def test_create_then_get_blob_round_trips(store: EventStore) -> None:
    repo = MediaRepository(store.raw)

    blob = await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=123, storage_key=SHA
    )

    assert blob.sha256 == SHA
    fetched = await repo.get_blob(SHA)
    assert fetched == blob


async def test_channels_referencing_an_unreferenced_blob_is_empty(store: EventStore) -> None:
    repo = MediaRepository(store.raw)
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )

    assert await repo.channels_referencing(SHA) == []


async def test_recording_a_reference_to_a_known_blob_makes_it_show_up(store: EventStore) -> None:
    repo = MediaRepository(store.raw)
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )

    await repo.record_references(_message_event(sha256=SHA), channel_id="chan1")

    assert await repo.channels_referencing(SHA) == ["chan1"]


async def test_recording_a_reference_to_an_unknown_blob_does_not_raise(store: EventStore) -> None:
    repo = MediaRepository(store.raw)

    await repo.record_references(_message_event(sha256=OTHER_SHA), channel_id="chan1")

    assert await repo.channels_referencing(OTHER_SHA) == []
