"""Encrypting small secrets (the Workspace Key's private bytes) at rest with
a server-wide secret (ADR-0002) — never the key material itself, only a
password-derived symmetric key over it."""

import base64
import hashlib

from cryptography.fernet import Fernet


def _fernet_key(server_secret: str) -> bytes:
    digest = hashlib.sha256(server_secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: bytes, *, server_secret: str) -> bytes:
    return Fernet(_fernet_key(server_secret)).encrypt(plaintext)


def decrypt_secret(ciphertext: bytes, *, server_secret: str) -> bytes:
    return Fernet(_fernet_key(server_secret)).decrypt(ciphertext)
