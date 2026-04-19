from cryptography.fernet import Fernet

from app.core.config import settings


def _fernet() -> Fernet:
    return Fernet(settings.session_secret.get_secret_value().encode())


def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())


def decrypt(ciphertext: bytes) -> str:
    return _fernet().decrypt(ciphertext).decode()
