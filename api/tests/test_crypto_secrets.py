"""RED: encrypting the Workspace Key at rest with a server secret
(ADR-0002: "the private key encrypted with a server secret")."""

import pytest

from studio_api.crypto_secrets import decrypt_secret, encrypt_secret


def test_round_trips_the_plaintext() -> None:
    plaintext = b"a 32-byte secp256k1 private key."

    ciphertext = encrypt_secret(plaintext, server_secret="correct-secret")

    assert decrypt_secret(ciphertext, server_secret="correct-secret") == plaintext


def test_ciphertext_does_not_contain_the_plaintext() -> None:
    plaintext = b"a 32-byte secp256k1 private key."

    ciphertext = encrypt_secret(plaintext, server_secret="correct-secret")

    assert plaintext not in ciphertext


def test_wrong_server_secret_cannot_decrypt() -> None:
    ciphertext = encrypt_secret(b"top secret", server_secret="correct-secret")

    with pytest.raises(Exception):  # noqa: B017 — any crypto failure is fine here
        decrypt_secret(ciphertext, server_secret="wrong-secret")
