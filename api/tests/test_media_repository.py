"""RED: the media repository — blob metadata, channel references and the
upload-declared DM recipients, against a real SurrealDB (same store as
ControlPlaneRepository's tests)."""

from studio_api.media.repository import MediaRepository
from studio_api.nostr.model import NostrEvent
from studio_api.nostr.store import EventStore

SHA = "a" * 64
OTHER_SHA = "b" * 64


class _FakeChannelMembership:
    def __init__(self, members: dict[str, set[str]] | None = None) -> None:
        self._members = members or {}

    async def is_channel_member(self, channel_id: str, pubkey: str) -> bool:
        return pubkey in self._members.get(channel_id, set())


def _repo(store: EventStore, members: dict[str, set[str]] | None = None) -> MediaRepository:
    return MediaRepository(store.raw, authorizer=_FakeChannelMembership(members))


def _message_event(
    *, sha256: str, channel_id: str = "chan1", pubkey: str = "uploader", extra_sha256: str | None = None
) -> NostrEvent:
    imeta = [["imeta", f"x {sha256}"]]
    if extra_sha256 is not None:
        imeta.append(["imeta", f"x {extra_sha256}"])
    return {
        "id": "evt1",
        "pubkey": pubkey,
        "created_at": 0,
        "kind": 9,
        "tags": [["h", channel_id], *imeta],
        "content": "",
        "sig": "sig",
    }


async def test_get_blob_before_creation_is_none(store: EventStore) -> None:
    repo = _repo(store)

    assert await repo.get_blob(SHA) is None


async def test_create_then_get_blob_round_trips(store: EventStore) -> None:
    repo = _repo(store)

    blob = await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=123, storage_key=SHA
    )

    assert blob.sha256 == SHA
    fetched = await repo.get_blob(SHA)
    assert fetched == blob


async def test_channels_referencing_an_unreferenced_blob_is_empty(store: EventStore) -> None:
    repo = _repo(store)
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )

    assert await repo.channels_referencing(SHA) == []


async def test_the_uploader_referencing_its_own_blob_records_the_channel(
    store: EventStore,
) -> None:
    repo = _repo(store)
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )

    await repo.record_references(_message_event(sha256=SHA), channel_id="chan1")

    assert await repo.channels_referencing(SHA) == ["chan1"]


async def test_recording_a_reference_to_an_unknown_blob_does_not_raise(store: EventStore) -> None:
    repo = _repo(store)

    await repo.record_references(_message_event(sha256=OTHER_SHA), channel_id="chan1")

    assert await repo.channels_referencing(OTHER_SHA) == []


async def test_a_stranger_referencing_someone_elses_blob_records_nothing(
    store: EventStore,
) -> None:
    """Ticket #38: a reference never grants what the publisher does not
    already have — otherwise naming a hash is enough to widen its ACL."""
    repo = _repo(store, {"chan1": {"stranger"}})
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )

    await repo.record_references(
        _message_event(sha256=SHA, pubkey="stranger"), channel_id="chan1"
    )

    assert await repo.channels_referencing(SHA) == []
    assert await repo.readable_blob(SHA, "stranger") is None


async def test_a_member_of_a_channel_that_already_has_the_blob_may_forward_it(
    store: EventStore,
) -> None:
    repo = _repo(store, {"chan1": {"uploader", "reader"}, "chan2": {"reader"}})
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )
    await repo.record_references(_message_event(sha256=SHA), channel_id="chan1")

    await repo.record_references(
        _message_event(sha256=SHA, channel_id="chan2", pubkey="reader"), channel_id="chan2"
    )

    assert sorted(await repo.channels_referencing(SHA)) == ["chan1", "chan2"]


async def test_a_registered_dm_recipient_may_reference_the_blob_in_a_channel(
    store: EventStore,
) -> None:
    repo = _repo(store, {"chan1": {"recipient"}})
    await repo.create_blob(
        sha256=SHA, pubkey="sender", mime="application/octet-stream", size=1, storage_key=SHA
    )
    await repo.record_dm_recipients(sha256=SHA, pubkeys=["recipient"])

    await repo.record_references(
        _message_event(sha256=SHA, pubkey="recipient"), channel_id="chan1"
    )

    assert await repo.channels_referencing(SHA) == ["chan1"]


async def test_a_rejected_reference_leaves_no_partial_acl_for_the_others(
    store: EventStore,
) -> None:
    repo = _repo(store, {"chan1": {"stranger"}})
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="image/jpeg", size=1, storage_key=SHA
    )
    await repo.create_blob(
        sha256=OTHER_SHA, pubkey="stranger", mime="image/jpeg", size=1, storage_key=OTHER_SHA
    )

    await repo.record_references(
        _message_event(sha256=SHA, extra_sha256=OTHER_SHA, pubkey="stranger"), channel_id="chan1"
    )

    assert await repo.channels_referencing(SHA) == []
    assert await repo.channels_referencing(OTHER_SHA) == ["chan1"]


async def test_dm_recipients_of_a_blob_uploaded_without_any_is_empty(store: EventStore) -> None:
    repo = _repo(store)
    await repo.create_blob(
        sha256=SHA, pubkey="uploader", mime="application/octet-stream", size=1, storage_key=SHA
    )

    assert await repo.dm_recipients(SHA) == []


async def test_recipients_declared_at_upload_can_read_the_blob(store: EventStore) -> None:
    repo = _repo(store)
    await repo.create_blob(
        sha256=SHA, pubkey="sender", mime="application/octet-stream", size=1, storage_key=SHA
    )

    await repo.record_dm_recipients(sha256=SHA, pubkeys=["recipient", "sender"])

    assert sorted(await repo.dm_recipients(SHA)) == ["recipient", "sender"]
    assert await repo.readable_blob(SHA, "recipient") is not None
    assert await repo.readable_blob(SHA, "outsider") is None
