"""sk_live_… API key mint + verify.

Key shape: sk_live_<8-char prefix>_<32-char random secret>
  - prefix shown in admin UI for human identification
  - full key returned ONCE at mint time, never stored
  - verification: hash the full key with argon2id, compare against stored hash

Why argon2 not sha256?
  Argon2 is the current OWASP recommendation. SHA256-only key stores are
  vulnerable to offline brute-force if the DB leaks. Argon2 is slow → expensive
  to brute-force. We don't need to be lightning-fast here because we hash at
  request time, but verify() is sub-millisecond on a CPU core.
"""
from __future__ import annotations

import secrets
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()
_PREFIX = "sk_live_"
_PREFIX_LEN = 8   # visible-to-admin
_SECRET_LEN = 32  # random bytes encoded as urlsafe-base64


def mint_key(prefix_label: str | None = None) -> tuple[str, str, str]:
    """Return (full_key, visible_prefix, hash).

    Caller must store (visible_prefix, hash, full_key returned ONCE).
    """
    prefix = secrets.token_urlsafe(_PREFIX_LEN)[:_PREFIX_LEN].replace("_", "x")
    secret = secrets.token_urlsafe(_SECRET_LEN)
    full_key = f"{_PREFIX}{prefix}_{secret}"
    visible_prefix = f"{_PREFIX}{prefix}"
    key_hash = _hasher.hash(full_key)
    return full_key, visible_prefix, key_hash


def verify_key(full_key: str, encoded_hash: str) -> bool:
    try:
        _hasher.verify(encoded_hash, full_key)
        return True
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def split_key(full_key: str) -> tuple[str, str] | None:
    """Return (visible_prefix, secret) or None if malformed."""
    if not full_key.startswith(_PREFIX):
        return None
    tail = full_key[len(_PREFIX):]
    if "_" not in tail:
        return None
    prefix, _, secret = tail.partition("_")
    return f"{_PREFIX}{prefix}", secret
