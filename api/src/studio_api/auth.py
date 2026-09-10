"""The REST control plane's authentication: a Firebase ID token or a NIP-98
event in the `Authorization` header, both resolving to a CallerIdentity.
Later tickets' endpoints depend on this, not on either scheme directly."""

import base64
import binascii
import json
import time
from dataclasses import dataclass
from typing import Protocol

from fastapi import Header, HTTPException, Request

from studio_api.nostr.crypto import has_valid_integrity
from studio_api.nostr.model import NostrEvent, first_tag_value

NIP98_KIND = 27235
NIP98_FRESHNESS_SECONDS = 60


class AuthError(Exception):
    pass


class FirebaseVerifier(Protocol):
    def verify(self, token: str) -> tuple[str, str]:
        """Returns (uid, email) for a valid ID token, or raises AuthError."""
        ...


@dataclass(frozen=True)
class FirebaseCaller:
    uid: str
    email: str


@dataclass(frozen=True)
class NostrCaller:
    pubkey: str


CallerIdentity = FirebaseCaller | NostrCaller


def verify_nip98(event: NostrEvent, *, url: str, method: str, now: int) -> str:
    """Returns the pubkey, or raises AuthError."""
    if event["kind"] != NIP98_KIND:
        raise AuthError("wrong kind")
    if not has_valid_integrity(event):
        raise AuthError("id/signature is invalid")
    if abs(now - event["created_at"]) > NIP98_FRESHNESS_SECONDS:
        raise AuthError("stale authorization event")
    if first_tag_value(event, "u") != url:
        raise AuthError("u tag does not match the requested URL")
    if first_tag_value(event, "method") != method:
        raise AuthError("method tag does not match the request method")
    return event["pubkey"]


def resolve_caller(
    authorization_header: str | None,
    *,
    firebase_verifier: FirebaseVerifier | None,
    url: str,
    method: str,
    now: int,
) -> CallerIdentity:
    if not authorization_header:
        raise AuthError("missing Authorization header")
    scheme, _, value = authorization_header.partition(" ")
    if scheme == "Bearer":
        if firebase_verifier is None:
            raise AuthError("Firebase authentication is not configured on this server")
        uid, email = firebase_verifier.verify(value)
        return FirebaseCaller(uid=uid, email=email)
    if scheme == "Nostr":
        try:
            event = json.loads(base64.b64decode(value, validate=True))
        except (binascii.Error, ValueError) as error:
            raise AuthError("malformed Nostr authorization event") from error
        return NostrCaller(pubkey=verify_nip98(event, url=url, method=method, now=now))
    raise AuthError(f"unsupported authorization scheme: {scheme!r}")


async def require_caller(
    request: Request, authorization: str | None = Header(default=None)
) -> CallerIdentity:
    """FastAPI dependency: resolves the caller or fails the request with 401.

    Reads the injectable `FirebaseVerifier` from `request.app.state.firebase_verifier`
    if the app set one — a NIP-98 caller works fine without it; a Bearer
    token without one configured fails with 401, not a crash.
    """
    verifier: FirebaseVerifier | None = getattr(request.app.state, "firebase_verifier", None)
    try:
        return resolve_caller(
            authorization,
            firebase_verifier=verifier,
            url=str(request.url),
            method=request.method,
            now=int(time.time()),
        )
    except AuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
