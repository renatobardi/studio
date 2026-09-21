"""Idempotently ensures the e2e test Accounts web/e2e's Playwright flows
sign in as (see web/e2e/helpers.ts) exist in Firebase with the password and
a verified email — issue #50. Run this inside the api container, which
already carries FIREBASE_CREDENTIALS_PATH: `python -m studio_api.ensure_e2e_accounts`.

Password and email_verified are forced on every run, existing or not: the
Admin SDK cannot read back a stored password to compare it, and re-seeding
studio-test's Firebase project must not silently leave a stale one behind.

The Accounts in RECREATED_ENV_PAIRS are the exception: they are deleted and
created again on every run. The flows that sign in as them assert first
access, which an Account only has once — and the API keys Accounts by Firebase
uid, so a new uid is a never-onboarded Account.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Protocol

# Each pair names the env vars web/e2e/helpers.ts reads for that Account.
ACCOUNT_ENV_PAIRS = [
    ("STUDIO_TEST_EMAIL", "STUDIO_TEST_PASSWORD"),
    ("STUDIO_TEST_EMAIL_2", "STUDIO_TEST_PASSWORD_2"),
    # Flow 11's Account (#157), whose Identity web/tools/seed-fixtures.ts links.
    ("STUDIO_TEST_FIXTURES_EMAIL", "STUDIO_TEST_FIXTURES_PASSWORD"),
]

# The Accounts that have to arrive never onboarded, because the flow that
# signs in as them asserts first access — a state an Account only has once.
# Flow 1 reaches it by Key Backup (#127); flow 9 by NIP-07 extension (#129),
# where the extension's key stays the same every run and what is given back is
# the Account's missing link to it.
RECREATED_ENV_PAIRS = [
    ("STUDIO_TEST_ONBOARDING_EMAIL", "STUDIO_TEST_ONBOARDING_PASSWORD"),
    ("STUDIO_TEST_EXTENSION_EMAIL", "STUDIO_TEST_EXTENSION_PASSWORD"),
]


@dataclass(frozen=True)
class ExistingUser:
    uid: str
    email_verified: bool


class AuthClient(Protocol):
    def get_user_by_email(self, email: str) -> ExistingUser | None:
        """Returns None if no user has this email."""
        ...

    def create_user(self, email: str, password: str) -> None: ...

    def update_user(self, uid: str, password: str) -> None: ...

    def delete_user(self, uid: str) -> None: ...


def ensure_account(client: AuthClient, email: str, password: str) -> str:
    """Returns a one-line description of what happened, for logging."""
    existing = client.get_user_by_email(email)
    if existing is None:
        client.create_user(email, password)
        return f"created {email} (verified)"
    client.update_user(existing.uid, password)
    return f"{email} already exists — reset password + verified"


def recreate_account(client: AuthClient, email: str, password: str) -> str:
    """Returns a one-line description of what happened, for logging."""
    existing = client.get_user_by_email(email)
    if existing is None:
        client.create_user(email, password)
        return f"created {email} (verified, never onboarded)"
    client.delete_user(existing.uid)
    client.create_user(email, password)
    return f"{email} recreated (verified, never onboarded)"


def _pairs_from_env(
    env: dict[str, str], names: list[tuple[str, str]]
) -> list[tuple[str, str]]:
    """Returns [(email, password), ...] for every pair with both vars set."""
    pairs = []
    for email_var, password_var in names:
        email, password = env.get(email_var), env.get(password_var)
        if email and password:
            pairs.append((email, password))
    return pairs


def accounts_from_env(env: dict[str, str]) -> list[tuple[str, str]]:
    return _pairs_from_env(env, ACCOUNT_ENV_PAIRS)


def recreated_accounts_from_env(env: dict[str, str]) -> list[tuple[str, str]]:
    return _pairs_from_env(env, RECREATED_ENV_PAIRS)


class _FirebaseAuthClient:
    """Wraps firebase_admin.auth for a specific app — the real AuthClient."""

    def __init__(self, app: object) -> None:
        self._app = app

    def get_user_by_email(self, email: str) -> ExistingUser | None:
        from firebase_admin import auth

        try:
            user = auth.get_user_by_email(email, app=self._app)
        except auth.UserNotFoundError:
            return None
        return ExistingUser(uid=user.uid, email_verified=user.email_verified)

    def create_user(self, email: str, password: str) -> None:
        from firebase_admin import auth

        auth.create_user(app=self._app, email=email, password=password, email_verified=True)

    def update_user(self, uid: str, password: str) -> None:
        from firebase_admin import auth

        auth.update_user(uid, app=self._app, password=password, email_verified=True)

    def delete_user(self, uid: str) -> None:
        from firebase_admin import auth

        auth.delete_user(uid, app=self._app)


def main() -> None:
    credentials_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")
    if not credentials_path:
        print("FIREBASE_CREDENTIALS_PATH is not set — nothing to seed", file=sys.stderr)
        sys.exit(1)

    pairs = accounts_from_env(dict(os.environ))
    recreated = recreated_accounts_from_env(dict(os.environ))
    if not pairs and not recreated:
        print("no STUDIO_TEST_*EMAIL*/PASSWORD* pairs set in the environment — nothing to seed")
        return

    import firebase_admin
    from firebase_admin import credentials as fb_credentials

    app = firebase_admin.initialize_app(fb_credentials.Certificate(credentials_path), name="e2e-seed")
    client = _FirebaseAuthClient(app)
    for email, password in pairs:
        print(ensure_account(client, email, password))
    for email, password in recreated:
        print(recreate_account(client, email, password))


if __name__ == "__main__":
    main()
