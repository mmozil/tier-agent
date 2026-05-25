from cryptography.fernet import Fernet

from core.config import get_settings


def _cipher() -> Fernet:
    key = get_settings().fernet_key.encode()
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    return _cipher().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _cipher().decrypt(ciphertext.encode()).decode()
