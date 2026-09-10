"""RED: the REST auth middleware — Firebase ID tokens and NIP-98 events,
both resolving to a CallerIdentity later endpoints can depend on.
"""

import base64
import json
import time

import pytest
from coincurve import PrivateKey
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from support import new_keypair, sign_event

from studio_api.auth import (
    AuthError,
    CallerIdentity,
    FirebaseCaller,
    NostrCaller,
    require_caller,
    resolve_caller,
    verify_nip98,
)
from studio_api.nostr.model import NostrEvent

URL = "https://api.example.com/api/workspaces"
METHOD = "POST"
NOW = 1_700_000_000


class _FakeFirebaseVerifier:
    """Mints/checks tokens of the form 'valid-token-for:<uid>'; anything
    else is rejected — a real verifier calls Firebase, this is the
    injectable stand-in the ticket calls for."""

    def verify(self, token: str) -> str:
        prefix = "valid-token-for:"
        if not token.startswith(prefix):
            raise AuthError("invalid Firebase ID token")
        return token[len(prefix) :]


def make_nip98_event(
    sk: PrivateKey,
    pubkey: str,
    *,
    url: str = URL,
    method: str = METHOD,
    created_at: int = NOW,
) -> NostrEvent:
    return sign_event(
        sk, pubkey=pubkey, created_at=created_at, kind=27235,
        tags=[["u", url], ["method", method]],
    )


def authorization_header_for(event: NostrEvent) -> str:
    encoded = base64.b64encode(json.dumps(event).encode("utf-8")).decode("ascii")
    return f"Nostr {encoded}"


class TestVerifyNip98:
    def test_a_well_formed_event_resolves_to_its_pubkey(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey)

        assert verify_nip98(event, url=URL, method=METHOD, now=NOW) == pubkey

    def test_wrong_kind_is_rejected(self) -> None:
        sk, pubkey = new_keypair()
        event = sign_event(
            sk, pubkey=pubkey, created_at=NOW, kind=1, tags=[["u", URL], ["method", METHOD]]
        )

        with pytest.raises(AuthError):
            verify_nip98(event, url=URL, method=METHOD, now=NOW)

    def test_wrong_url_is_rejected(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey, url="https://api.example.com/api/other")

        with pytest.raises(AuthError):
            verify_nip98(event, url=URL, method=METHOD, now=NOW)

    def test_wrong_method_is_rejected(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey, method="GET")

        with pytest.raises(AuthError):
            verify_nip98(event, url=URL, method=METHOD, now=NOW)

    def test_stale_event_is_rejected(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey, created_at=NOW - 3600)

        with pytest.raises(AuthError):
            verify_nip98(event, url=URL, method=METHOD, now=NOW)

    def test_tampered_event_is_rejected(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey)
        tampered: NostrEvent = {**event, "tags": [["u", "https://evil.example.com"], ["method", METHOD]]}

        with pytest.raises(AuthError):
            verify_nip98(tampered, url=URL, method=METHOD, now=NOW)


class TestResolveCaller:
    def test_a_bearer_token_resolves_to_a_firebase_caller(self) -> None:
        caller = resolve_caller(
            "Bearer valid-token-for:abc123",
            firebase_verifier=_FakeFirebaseVerifier(),
            url=URL,
            method=METHOD,
            now=NOW,
        )

        assert caller == FirebaseCaller(uid="abc123")

    def test_an_invalid_bearer_token_is_rejected(self) -> None:
        with pytest.raises(AuthError):
            resolve_caller(
                "Bearer not-a-real-token",
                firebase_verifier=_FakeFirebaseVerifier(),
                url=URL,
                method=METHOD,
                now=NOW,
            )

    def test_a_bearer_token_without_a_configured_verifier_is_rejected(self) -> None:
        # NIP-98 callers should not be collateral damage of Firebase not
        # being wired up yet (it isn't, until ticket #3's endpoints need it).
        with pytest.raises(AuthError):
            resolve_caller(
                "Bearer valid-token-for:abc123",
                firebase_verifier=None,
                url=URL,
                method=METHOD,
                now=NOW,
            )

    def test_a_nostr_header_works_without_a_configured_firebase_verifier(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey)
        header = authorization_header_for(event)

        caller = resolve_caller(header, firebase_verifier=None, url=URL, method=METHOD, now=NOW)

        assert caller == NostrCaller(pubkey=pubkey)

    def test_a_nostr_header_resolves_to_a_nostr_caller(self) -> None:
        sk, pubkey = new_keypair()
        event = make_nip98_event(sk, pubkey)
        header = authorization_header_for(event)

        caller = resolve_caller(
            header, firebase_verifier=_FakeFirebaseVerifier(), url=URL, method=METHOD, now=NOW
        )

        assert caller == NostrCaller(pubkey=pubkey)

    def test_a_missing_header_is_rejected(self) -> None:
        with pytest.raises(AuthError):
            resolve_caller(
                None, firebase_verifier=_FakeFirebaseVerifier(), url=URL, method=METHOD, now=NOW
            )

    def test_an_unsupported_scheme_is_rejected(self) -> None:
        with pytest.raises(AuthError):
            resolve_caller(
                "Basic dXNlcjpwYXNz",
                firebase_verifier=_FakeFirebaseVerifier(),
                url=URL,
                method=METHOD,
                now=NOW,
            )

    def test_malformed_nostr_payload_is_rejected(self) -> None:
        with pytest.raises(AuthError):
            resolve_caller(
                "Nostr not-valid-base64!!!",
                firebase_verifier=_FakeFirebaseVerifier(),
                url=URL,
                method=METHOD,
                now=NOW,
            )


def _make_protected_app(*, with_firebase_verifier: bool = True) -> FastAPI:
    app = FastAPI()
    if with_firebase_verifier:
        app.state.firebase_verifier = _FakeFirebaseVerifier()
    # else: main.py doesn't wire this attribute at all until an endpoint
    # actually needs Firebase — require_caller must not assume it exists.

    @app.get("/protected")
    async def protected(
        caller: CallerIdentity = Depends(require_caller),  # noqa: B008 — FastAPI's own idiom
    ) -> dict[str, str]:
        if isinstance(caller, FirebaseCaller):
            return {"kind": "firebase", "id": caller.uid}
        return {"kind": "nostr", "id": caller.pubkey}

    return app


class TestRequireCallerDependency:
    async def test_a_valid_bearer_token_reaches_the_route(self) -> None:
        app = _make_protected_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/protected", headers={"Authorization": "Bearer valid-token-for:abc123"}
            )

        assert response.status_code == 200
        assert response.json() == {"kind": "firebase", "id": "abc123"}

    async def test_a_valid_nip98_event_reaches_the_route(self) -> None:
        app = _make_protected_app()
        sk, pubkey = new_keypair()
        event = make_nip98_event(
            sk, pubkey, url="http://test/protected", method="GET", created_at=int(time.time())
        )
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/protected", headers={"Authorization": authorization_header_for(event)}
            )

        assert response.status_code == 200
        assert response.json() == {"kind": "nostr", "id": pubkey}

    async def test_a_missing_header_is_rejected_with_401(self) -> None:
        app = _make_protected_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/protected")

        assert response.status_code == 401

    async def test_nip98_reaches_the_route_when_no_firebase_verifier_is_configured(
        self,
    ) -> None:
        app = _make_protected_app(with_firebase_verifier=False)
        sk, pubkey = new_keypair()
        event = make_nip98_event(
            sk, pubkey, url="http://test/protected", method="GET", created_at=int(time.time())
        )
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/protected", headers={"Authorization": authorization_header_for(event)}
            )

        assert response.status_code == 200
        assert response.json() == {"kind": "nostr", "id": pubkey}

    async def test_a_bearer_token_with_no_firebase_verifier_configured_is_401_not_a_crash(
        self,
    ) -> None:
        app = _make_protected_app(with_firebase_verifier=False)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/protected", headers={"Authorization": "Bearer valid-token-for:abc123"}
            )

        assert response.status_code == 401
