import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger(__name__)


def _derive_fernet_key(raw: str) -> bytes:
    """Derive a valid Fernet key from any secret string (e.g. openssl rand -hex 32)."""
    digest = hashlib.sha256(raw.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    key = settings.oidc_enc_key
    if not key:
        raise RuntimeError(
            "OIDC_ENC_KEY is not configured. "
            "Generate one with: openssl rand -hex 32"
        )
    return Fernet(_derive_fernet_key(key))

def encrypt_secret(plaintext: str) -> str:
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    f = _get_fernet()
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt OIDC secret — key may have changed")
        raise RuntimeError("Failed to decrypt OIDC secret")
