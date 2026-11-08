
import os
import hmac
import hashlib
import secrets

from dotenv import load_dotenv
from argon2.low_level import hash_secret_raw, Type
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

load_dotenv()

INDEX_KEY = os.getenv("VAULT_INDEX_KEY")
MASTER_KEY = os.getenv("APP_MASTER_KEY")

if not INDEX_KEY or not MASTER_KEY:
    raise RuntimeError(
        "VAULT_INDEX_KEY and APP_MASTER_KEY must be configured in .env"
    )

try:
    INDEX_KEY_BYTES = bytes.fromhex(INDEX_KEY)
    MASTER_KEY_BYTES = bytes.fromhex(MASTER_KEY)
except ValueError:
    raise RuntimeError("Security keys must be hexadecimal values")

if len(INDEX_KEY_BYTES) < 32 or len(MASTER_KEY_BYTES) != 32:
    raise RuntimeError("Invalid security key length")


def get_password_fingerprint(password: str) -> str:
    return hmac.new(
        INDEX_KEY_BYTES,
        password.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


def derive_encryption_key(password: str, salt: bytes) -> bytes:
    return hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=2,
        memory_cost=19456,
        parallelism=1,
        hash_len=32,
        type=Type.ID
    )


def create_vault_check(password: str):
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)

    key = derive_encryption_key(password, salt)

    encrypted_check = AESGCM(key).encrypt(
        nonce,
        b"CodedPad vault verification v1",
        b"codedpad-vault-check"
    )

    return salt, nonce, encrypted_check


def verify_vault_password(password: str, vault) -> bool:
    try:
        key = derive_encryption_key(password, vault.encryption_salt)

        decrypted = AESGCM(key).decrypt(
            vault.check_nonce,
            vault.encrypted_check,
            b"codedpad-vault-check"
        )

        return hmac.compare_digest(
            decrypted,
            b"CodedPad vault verification v1"
        )

    except Exception:
        return False


def wrap_encryption_key(key: bytes, vault_id: int):
    nonce = secrets.token_bytes(12)

    wrapped = AESGCM(MASTER_KEY_BYTES).encrypt(
        nonce,
        key,
        f"codedpad-vault-{vault_id}".encode()
    )

    return nonce, wrapped


def unwrap_encryption_key(
    nonce: bytes,
    wrapped_key: bytes,
    vault_id: int
) -> bytes:
    return AESGCM(MASTER_KEY_BYTES).decrypt(
        nonce,
        wrapped_key,
        f"codedpad-vault-{vault_id}".encode()
    )


def create_access_token() -> str:
    return secrets.token_urlsafe(32)


def hash_access_token(token: str) -> str:
    return hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()
