"""RED: what has to be true of a restored Studio before the restore counts as
proven (issue #53) — the Workspace Key comes back from the secret manager and
still matches the Workspace row, the Channel timeline still holds Messages,
memberships survived, every Workspace-signed projection still verifies against
that key, and every blob row has its bytes back intact.

A backup that restores rows but leaves the Workspace Key unrecoverable is not a
restore: the projections can never be signed again. That is why the key check is
part of the evidence and not a separate ceremony.
"""

import hashlib
from typing import cast

from coincurve import PrivateKey

from studio_api.crypto_secrets import encrypt_secret
from studio_api.nostr.model import NostrEvent
from studio_api.nostr.projection import (
    PROJECTION_KINDS,
    build_workspace_add,
    build_workspace_member_list,
)
from studio_api.nostr.signing import sign_event
from studio_api.verify_restore import (
    RestoreEvidence,
    WorkspaceEvidence,
    audit_blobs,
    audit_workspace,
    classify_blob,
    recover_key_pubkey,
)

SERVER_SECRET = "the-server-secret"
OTHER_SECRET = "a-different-server-secret"


def _workspace_key() -> tuple[PrivateKey, str, bytes]:
    """A Workspace Key as a restored `workspace` row holds it: the private key,
    its x-only pubkey, and the Fernet blob encrypted with the server secret."""
    sk = PrivateKey()
    pubkey = sk.public_key_xonly.format().hex()
    return sk, pubkey, encrypt_secret(sk.secret, server_secret=SERVER_SECRET)


def _message() -> NostrEvent:
    return sign_event(PrivateKey(), kind=9, tags=[["h", "general"]], content="hello")


def _sha256_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class TestRecoverKeyPubkey:
    def test_recovers_the_pubkey_with_the_restored_server_secret(self) -> None:
        _, key_pubkey, encrypted = _workspace_key()

        assert recover_key_pubkey(encrypted, server_secret=SERVER_SECRET) == key_pubkey

    def test_recovers_nothing_when_the_secret_is_not_the_one_that_encrypted_it(self) -> None:
        _, _, encrypted = _workspace_key()

        assert recover_key_pubkey(encrypted, server_secret=OTHER_SECRET) is None

    def test_recovers_nothing_from_a_corrupted_blob(self) -> None:
        assert recover_key_pubkey(b"not-a-fernet-token", server_secret=SERVER_SECRET) is None


class TestAuditWorkspace:
    def test_a_fully_restored_workspace_is_evidence_of_recovery(self) -> None:
        sk, key_pubkey, encrypted = _workspace_key()
        events = [
            _message(),
            build_workspace_member_list(sk, members=[(key_pubkey, "owner")]),
            build_workspace_add(sk, pubkey=key_pubkey),
        ]

        evidence = audit_workspace(
            slug="family",
            key_pubkey=key_pubkey,
            encrypted_key=encrypted,
            events=events,
            memberships=2,
            server_secret=SERVER_SECRET,
        )

        assert evidence == WorkspaceEvidence(
            slug="family",
            key_recovered=True,
            messages=1,
            memberships=2,
            projections=2,
            unsigned_projections=(),
        )
        assert evidence.ok

    def test_a_workspace_whose_key_cannot_be_decrypted_is_not_recovered(self) -> None:
        sk, key_pubkey, encrypted = _workspace_key()

        evidence = audit_workspace(
            slug="family",
            key_pubkey=key_pubkey,
            encrypted_key=encrypted,
            events=[_message(), build_workspace_add(sk, pubkey=key_pubkey)],
            memberships=1,
            server_secret=OTHER_SECRET,
        )

        assert not evidence.key_recovered
        assert not evidence.ok

    def test_a_key_that_no_longer_matches_the_workspace_row_is_not_recovered(self) -> None:
        _, _, encrypted = _workspace_key()
        stale_pubkey = PrivateKey().public_key_xonly.format().hex()

        evidence = audit_workspace(
            slug="family",
            key_pubkey=stale_pubkey,
            encrypted_key=encrypted,
            events=[],
            memberships=1,
            server_secret=SERVER_SECRET,
        )

        assert not evidence.key_recovered

    def test_a_projection_signed_by_anything_but_the_workspace_key_is_reported(self) -> None:
        sk, key_pubkey, encrypted = _workspace_key()
        forged = build_workspace_add(PrivateKey(), pubkey=key_pubkey)

        evidence = audit_workspace(
            slug="family",
            key_pubkey=key_pubkey,
            encrypted_key=encrypted,
            events=[_message(), build_workspace_add(sk, pubkey=key_pubkey), forged],
            memberships=1,
            server_secret=SERVER_SECRET,
        )

        assert evidence.projections == 2
        assert evidence.unsigned_projections == (forged["id"],)
        assert not evidence.ok

    def test_a_projection_whose_content_changed_after_signing_is_reported(self) -> None:
        sk, key_pubkey, encrypted = _workspace_key()
        signed = build_workspace_member_list(sk, members=[(key_pubkey, "owner")])
        tampered = cast(NostrEvent, {**signed, "content": "tampered in the backup"})

        evidence = audit_workspace(
            slug="family",
            key_pubkey=key_pubkey,
            encrypted_key=encrypted,
            events=[_message(), tampered],
            memberships=1,
            server_secret=SERVER_SECRET,
        )

        assert evidence.unsigned_projections == (signed["id"],)
        assert not evidence.ok

    def test_a_workspace_nobody_has_spoken_in_yet_is_still_sound(self) -> None:
        """studio-test holds Workspaces created by the e2e run that carry
        members and no events at all. Demanding a Message of every Workspace
        would fail a restore that lost nothing."""
        sk, key_pubkey, encrypted = _workspace_key()

        evidence = audit_workspace(
            slug="e2e-test",
            key_pubkey=key_pubkey,
            encrypted_key=encrypted,
            events=[build_workspace_add(sk, pubkey=key_pubkey)],
            memberships=1,
            server_secret=SERVER_SECRET,
        )

        assert evidence.messages == 0
        assert evidence.ok

    def test_a_workspace_restored_without_memberships_is_not_proof_of_recovery(self) -> None:
        sk, key_pubkey, encrypted = _workspace_key()

        evidence = audit_workspace(
            slug="family",
            key_pubkey=key_pubkey,
            encrypted_key=encrypted,
            events=[_message(), build_workspace_add(sk, pubkey=key_pubkey)],
            memberships=0,
            server_secret=SERVER_SECRET,
        )

        assert not evidence.ok



class TestProjectionKinds:
    def test_every_kind_the_projection_signs_is_one_the_audit_looks_for(self) -> None:
        sk = PrivateKey()
        pubkey = sk.public_key_xonly.format().hex()
        built = [
            build_workspace_member_list(sk, members=[(pubkey, "owner")]),
            build_workspace_add(sk, pubkey=pubkey),
        ]

        assert {event["kind"] for event in built} <= PROJECTION_KINDS


class TestClassifyBlob:
    def test_bytes_that_hash_to_the_row_are_intact(self) -> None:
        content = b"an attachment"

        assert classify_blob(_sha256_of(content), content) == "intact"

    def test_bytes_that_hash_to_anything_else_are_corrupt(self) -> None:
        assert classify_blob(_sha256_of(b"expected"), b"something else") == "corrupt"

    def test_a_row_whose_object_is_not_in_the_bucket_is_missing(self) -> None:
        assert classify_blob(_sha256_of(b"x"), None) == "missing"


class TestAuditBlobs:
    def test_counts_every_row_and_names_the_ones_that_did_not_come_back(self) -> None:
        intact = b"intact"
        corrupt_digest = _sha256_of(b"expected")
        missing_digest = _sha256_of(b"gone")

        blobs, missing, corrupt = audit_blobs(
            [
                (_sha256_of(intact), intact),
                (corrupt_digest, b"something else"),
                (missing_digest, None),
            ]
        )

        assert blobs == 3
        assert corrupt == (corrupt_digest,)
        assert missing == (missing_digest,)


class TestRestoreEvidence:
    def _sound_workspace(self) -> WorkspaceEvidence:
        return WorkspaceEvidence(
            slug="family",
            key_recovered=True,
            messages=3,
            memberships=2,
            projections=4,
            unsigned_projections=(),
        )

    def test_a_restore_with_sound_workspaces_and_blobs_is_proven(self) -> None:
        evidence = RestoreEvidence(
            workspaces=(self._sound_workspace(),), blobs=2, missing_blobs=(), corrupt_blobs=()
        )

        assert evidence.ok

    def test_a_restore_with_no_workspaces_proves_nothing(self) -> None:
        assert not RestoreEvidence(
            workspaces=(), blobs=2, missing_blobs=(), corrupt_blobs=()
        ).ok

    def test_a_restore_where_nobody_said_anything_anywhere_proves_nothing(self) -> None:
        """Every Workspace sound and not one Message or projection between
        them is an empty database that restored cleanly — the shape a silently
        broken dump takes."""
        empty = WorkspaceEvidence(
            slug="family",
            key_recovered=True,
            messages=0,
            memberships=2,
            projections=0,
            unsigned_projections=(),
        )

        assert empty.ok
        assert not RestoreEvidence(
            workspaces=(empty,), blobs=0, missing_blobs=(), corrupt_blobs=()
        ).ok

    def test_one_unsound_workspace_fails_the_whole_restore(self) -> None:
        broken = WorkspaceEvidence(
            slug="other",
            key_recovered=False,
            messages=1,
            memberships=1,
            projections=1,
            unsigned_projections=(),
        )

        assert not RestoreEvidence(
            workspaces=(self._sound_workspace(), broken),
            blobs=0,
            missing_blobs=(),
            corrupt_blobs=(),
        ).ok

    def test_a_blob_that_did_not_come_back_fails_the_whole_restore(self) -> None:
        assert not RestoreEvidence(
            workspaces=(self._sound_workspace(),),
            blobs=1,
            missing_blobs=("deadbeef",),
            corrupt_blobs=(),
        ).ok
