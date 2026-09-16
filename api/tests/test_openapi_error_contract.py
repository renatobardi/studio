"""The error answers each control-plane and media endpoint can give, as the
OpenAPI document states them (issue #76).

A status code a client must handle is part of the interface, and until now it
lived only in `raise HTTPException(...)` lines the document said nothing
about — so a generated client, or anyone reading /docs, saw a 200 and a 422
for endpoints that answer 403 and 410 every day. This table is the contract:
add an error answer to a route and the test fails until the route declares it.

422 is left out on purpose — FastAPI documents request-validation failures by
itself, for every route that takes a body or a typed parameter.
"""

from studio_api.main import create_app

# (method, path) -> the error statuses that endpoint can answer.
#
# Statuses raised by the shared helpers count: `_caller_pubkey` answers 400
# to a Firebase caller with no linked Identity, and the membership helpers
# answer 403 — a caller sees those from the endpoint, not from the helper.
ERROR_CONTRACT: dict[tuple[str, str], set[int]] = {
    ("get", "/api/account"): {403},
    ("post", "/api/account/link-identity"): {400, 403, 409},
    ("put", "/api/account/key-backup"): {400, 403},
    ("get", "/api/account/key-backup"): {403, 404},
    ("get", "/api/workspaces"): {400},
    ("post", "/api/workspaces"): {400, 409},
    ("get", "/api/workspaces/{slug}"): {400, 403, 404},
    ("post", "/api/workspaces/{slug}/invites"): {400, 403},
    ("get", "/api/workspaces/{slug}/invites"): {400, 403},
    ("delete", "/api/workspaces/{slug}/invites/{code}"): {400, 403},
    ("get", "/api/invites/{code}"): set(),
    ("post", "/api/invites/{code}/redeem"): {403, 404, 410},
    ("get", "/api/workspaces/{slug}/members"): {400, 403},
    ("patch", "/api/workspaces/{slug}/members/{member_pubkey}"): {400, 403},
    ("delete", "/api/workspaces/{slug}/members/{member_pubkey}"): {400, 403},
    ("post", "/api/workspaces/{slug}/channels"): {400, 403},
    ("get", "/api/workspaces/{slug}/channels"): {400, 403},
    ("post", "/api/workspaces/{slug}/channels/{channel_id}/members"): {400, 403},
    ("get", "/api/workspaces/{slug}/channels/{channel_id}/members"): {400, 403},
    ("delete", "/api/workspaces/{slug}/channels/{channel_id}/members/{member_pubkey}"): {
        400,
        403,
    },
    ("put", "/media/upload"): {400, 401, 403, 413, 415},
    ("get", "/media/{sha256_with_ext}"): {401, 403},
}

_HEALTH_PATHS = {"/api/health", "/api/ready"}


def _documented_errors() -> dict[tuple[str, str], set[int]]:
    schema = create_app(store=None).openapi()
    found: dict[tuple[str, str], set[int]] = {}
    for path, operations in schema["paths"].items():
        if path in _HEALTH_PATHS or not path.startswith(("/api/", "/media/")):
            continue
        for method, operation in operations.items():
            statuses = {int(code) for code in operation["responses"] if code.isdigit()}
            found[(method, path)] = {s for s in statuses if s >= 400 and s != 422}
    return found


def test_every_control_and_media_endpoint_is_in_the_contract() -> None:
    # A new endpoint has to declare what it can refuse, here and in the app.
    assert set(_documented_errors()) == set(ERROR_CONTRACT)


def test_endpoints_document_the_errors_they_can_answer() -> None:
    assert _documented_errors() == ERROR_CONTRACT
