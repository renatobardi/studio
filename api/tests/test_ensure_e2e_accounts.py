"""RED: idempotent seeding of the e2e test Accounts web/e2e/helpers.ts signs
in as (issue #50) — a missing Account gets created verified, an existing one
gets its password and verified flag forced to match, and a pair with either
env var unset is skipped rather than guessed at.
"""

from studio_api.ensure_e2e_accounts import (
    ExistingUser,
    accounts_from_env,
    ensure_account,
    onboarding_account_from_env,
    recreate_account,
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


class TestOnboardingAccountFromEnv:
    def test_returns_the_pair_when_both_vars_are_set(self) -> None:
        env = {"STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com", "STUDIO_TEST_ONBOARDING_PASSWORD": "pw"}

        assert onboarding_account_from_env(env) == ("o@example.com", "pw")

    def test_returns_none_when_either_var_is_missing(self) -> None:
        assert onboarding_account_from_env({"STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com"}) is None
        assert onboarding_account_from_env({"STUDIO_TEST_ONBOARDING_PASSWORD": "pw"}) is None

    def test_is_not_one_of_the_accounts_that_keep_their_uid(self) -> None:
        env = {"STUDIO_TEST_ONBOARDING_EMAIL": "o@example.com", "STUDIO_TEST_ONBOARDING_PASSWORD": "pw"}

        assert accounts_from_env(env) == []


class TestAccountsFromEnv:
    def test_includes_a_pair_with_both_vars_set(self) -> None:
        env = {"STUDIO_TEST_EMAIL": "a@example.com", "STUDIO_TEST_PASSWORD": "pw"}

        assert accounts_from_env(env) == [("a@example.com", "pw")]

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
            "STUDIO_TEST_EXTENSION_EMAIL": "c@example.com",
            "STUDIO_TEST_EXTENSION_PASSWORD": "pw-c",
            # Flow 11's Account (#157): signed in on every run, so its uid must stay.
            "STUDIO_TEST_FIXTURES_EMAIL": "d@example.com",
            "STUDIO_TEST_FIXTURES_PASSWORD": "pw-d",
        }

        assert accounts_from_env(env) == [
            ("a@example.com", "pw-a"),
            ("b@example.com", "pw-b"),
            ("c@example.com", "pw-c"),
            ("d@example.com", "pw-d"),
        ]
