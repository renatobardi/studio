"""RED: idempotent seeding of the e2e test Accounts web/e2e/helpers.ts signs
in as (issue #50) — a missing Account gets created verified, an existing one
gets its password and verified flag forced to match, and a pair with either
env var unset is skipped rather than guessed at.
"""

import os
import sys

import pytest

from studio_api.ensure_e2e_accounts import (
    ExistingUser,
    accounts_from_env,
    anything_to_seed,
    ensure_account,
    main,
    recreate_account,
    recreated_accounts_from_env,
    seed,
)


class _FakeAuthClient:
    def __init__(self, existing: dict[str, ExistingUser] | None = None) -> None:
        self.existing = existing or {}
        self.created: list[tuple[str, str]] = []
        self.updated: list[tuple[str, str]] = []
        self.deleted: list[str] = []

    def get_user_by_email(self, email: str) -> ExistingUser | None:
        return self.existing.get(email)

    def create_user(self, email: str, password: str) -> None:
        self.created.append((email, password))

    def update_user(self, uid: str, password: str) -> None:
        self.updated.append((uid, password))

    def delete_user(self, uid: str) -> None:
        self.deleted.append(uid)


class TestEnsureAccount:
    def test_creates_a_missing_account(self) -> None:
        client = _FakeAuthClient()

        result = ensure_account(client, "a@example.com", "pw")

        assert client.created == [("a@example.com", "pw")]
        assert client.updated == []
        assert "created" in result
        # The address is a GitHub secret and this line ends up in a public CD
        # log: what happened, never to whom.
        assert "a@example.com" not in result

    def test_resets_password_and_verified_flag_on_an_existing_account(self) -> None:
        client = _FakeAuthClient({"a@example.com": ExistingUser(uid="uid-1", email_verified=False)})

        result = ensure_account(client, "a@example.com", "pw")

        assert client.created == []
        assert client.updated == [("uid-1", "pw")]
        assert "already exists" in result

    def test_still_resets_an_already_verified_account(self) -> None:
        # Re-seeding studio-test's Firebase project can leave a stale password
        # behind even when email_verified already reads True — force both.
        client = _FakeAuthClient({"a@example.com": ExistingUser(uid="uid-1", email_verified=True)})

        ensure_account(client, "a@example.com", "pw")

        assert client.updated == [("uid-1", "pw")]


class TestRecreateAccount:
    # Flow 1 asserts first access, which an Account only has once: a new uid is
    # a new, never-onboarded Account (the API keys Accounts by Firebase uid).
    def test_deletes_an_existing_account_before_creating_it_again(self) -> None:
        client = _FakeAuthClient({"o@example.com": ExistingUser(uid="uid-old", email_verified=True)})

        result = recreate_account(client, "o@example.com", "pw")

        assert client.deleted == ["uid-old"]
        assert client.created == [("o@example.com", "pw")]
        assert client.updated == []
        assert "recreated" in result

    def test_creates_a_missing_account_without_deleting_anything(self) -> None:
        client = _FakeAuthClient()

        recreate_account(client, "o@example.com", "pw")

        assert client.deleted == []
        assert client.created == [("o@example.com", "pw")]


class TestRecreatedAccountsFromEnv:
    """Issue #129: first access is a state an Account only has once, and the
    API keys Accounts by Firebase uid — so every flow that asserts it needs a
    new uid before the smoke. Flow 1 by Key Backup, flow 9 by NIP-07
    extension."""

    def test_returns_the_pair_when_both_vars_are_set(self) -> None:
        env = {"STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com", "STUDIO_TEST_ONBOARDING_PASSWORD": "pw"}

        assert recreated_accounts_from_env(env) == [
            ("STUDIO_TEST_ONBOARDING_EMAIL", "o@example.com", "pw")
        ]

    def test_skips_a_pair_missing_either_var(self) -> None:
        assert recreated_accounts_from_env({"STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com"}) == []
        assert recreated_accounts_from_env({"STUDIO_TEST_ONBOARDING_PASSWORD": "pw"}) == []

    def test_includes_the_extension_account(self) -> None:
        env = {
            "STUDIO_TEST_EXTENSION_EMAIL": "c@example.com",
            "STUDIO_TEST_EXTENSION_PASSWORD": "pw-c",
        }

        assert recreated_accounts_from_env(env) == [
            ("STUDIO_TEST_EXTENSION_EMAIL", "c@example.com", "pw-c")
        ]

    def test_none_of_them_is_an_account_that_keeps_its_uid(self) -> None:
        env = {
            "STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com",
            "STUDIO_TEST_ONBOARDING_PASSWORD": "pw",
            "STUDIO_TEST_EXTENSION_EMAIL": "c@example.com",
            "STUDIO_TEST_EXTENSION_PASSWORD": "pw-c",
        }

        assert accounts_from_env(env) == []


class TestAccountsFromEnv:
    def test_includes_a_pair_with_both_vars_set(self) -> None:
        env = {"STUDIO_TEST_EMAIL": "a@example.com", "STUDIO_TEST_PASSWORD": "pw"}

        assert accounts_from_env(env) == [("STUDIO_TEST_EMAIL", "a@example.com", "pw")]

    def test_skips_a_pair_missing_its_password(self) -> None:
        env = {"STUDIO_TEST_EMAIL_2": "b@example.com"}

        assert accounts_from_env(env) == []

    def test_skips_a_pair_missing_its_email(self) -> None:
        env = {"STUDIO_TEST_PASSWORD_2": "pw"}

        assert accounts_from_env(env) == []

    def test_collects_every_configured_pair(self) -> None:
        env = {
            "STUDIO_TEST_EMAIL": "a@example.com",
            "STUDIO_TEST_PASSWORD": "pw-a",
            "STUDIO_TEST_EMAIL_2": "b@example.com",
            "STUDIO_TEST_PASSWORD_2": "pw-b",
            # Flow 11's Account (#157): signed in on every run, so its uid must stay.
            "STUDIO_TEST_FIXTURES_EMAIL": "d@example.com",
            "STUDIO_TEST_FIXTURES_PASSWORD": "pw-d",
        }

        assert accounts_from_env(env) == [
            ("STUDIO_TEST_EMAIL", "a@example.com", "pw-a"),
            ("STUDIO_TEST_EMAIL_2", "b@example.com", "pw-b"),
            ("STUDIO_TEST_FIXTURES_EMAIL", "d@example.com", "pw-d"),
        ]


class TestSeed:
    """Issue #129: which Accounts survive a run and which are replaced is the
    whole behaviour of this script, and it is what the smoke depends on."""

    def _env(self) -> dict[str, str]:
        return {
            "STUDIO_TEST_EMAIL": "a@example.com",
            "STUDIO_TEST_PASSWORD": "pw-a",
            "STUDIO_TEST_FIXTURES_EMAIL": "d@example.com",
            "STUDIO_TEST_FIXTURES_PASSWORD": "pw-d",
            "STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com",
            "STUDIO_TEST_ONBOARDING_PASSWORD": "pw-o",
            "STUDIO_TEST_EXTENSION_EMAIL": "c@example.com",
            "STUDIO_TEST_EXTENSION_PASSWORD": "pw-c",
        }

    def _existing(self) -> dict[str, ExistingUser]:
        return {
            email: ExistingUser(uid=f"uid-{email[0]}", email_verified=True)
            for email in ("a@example.com", "d@example.com", "o@example.com", "c@example.com")
        }

    def test_only_the_first_access_accounts_are_deleted_and_created_again(self) -> None:
        client = _FakeAuthClient(self._existing())

        seed(client, self._env())

        # The extension Account joins flow 1's (#129); flow 11's fixtures
        # Account and the ordinary ones keep the uid their state hangs off.
        assert client.deleted == ["uid-o", "uid-c"]
        assert client.created == [("o@example.com", "pw-o"), ("c@example.com", "pw-c")]
        assert client.updated == [("uid-a", "pw-a"), ("uid-d", "pw-d")]

    def test_the_log_names_the_variable_and_never_the_address(self) -> None:
        client = _FakeAuthClient(self._existing())

        lines = seed(client, self._env())

        assert lines == [
            "STUDIO_TEST_EMAIL: already exists — reset password + verified",
            "STUDIO_TEST_FIXTURES_EMAIL: already exists — reset password + verified",
            "STUDIO_TEST_ONBOARDING_EMAIL: recreated (verified, never onboarded)",
            "STUDIO_TEST_EXTENSION_EMAIL: recreated (verified, never onboarded)",
        ]
        # These addresses are GitHub secrets and this output is a public CD log.
        assert not any("@example.com" in line for line in lines)

    def test_an_environment_naming_no_account_is_not_worth_reaching_firebase_for(self) -> None:
        # Every studio-prd container: no STUDIO_TEST_* at all (docs/production.md).
        assert anything_to_seed({}) is False
        assert anything_to_seed(self._env()) is True

    def test_a_run_with_no_account_named_never_reaches_firebase(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # A credential is present and still nothing is touched: on studio-prd
        # this script is a no-op, and that is what keeps it a no-op there.
        monkeypatch.setattr(os, "environ", {"FIREBASE_CREDENTIALS_PATH": "/run/secrets/x.json"})
        monkeypatch.setitem(sys.modules, "firebase_admin", None)

        main()

        assert "nothing to seed" in capsys.readouterr().out
