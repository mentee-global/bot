class AuthError(Exception):
    """Base for all auth-layer errors."""


class StateMismatchError(AuthError):
    """Callback state was unknown, already-used, or expired."""


class CodeExchangeError(AuthError):
    """POST /oauth/token for the authorization_code grant failed."""


class InvalidIdTokenError(AuthError):
    """id_token signature, claims, or nonce failed verification."""


class RefreshFailedError(AuthError):
    """POST /oauth/token for the refresh_token grant failed for any reason."""


class RefreshUnsupportedError(RefreshFailedError):
    """Provider returned unsupported_grant_type or invalid_grant on refresh.

    Expected today because Mentee's MenteeRefreshTokenGrant is not yet
    registered (see docs/oauth/00-oauth-overview.md §2.5). Must be classified
    as INFO in logs, not WARNING/ERROR.
    """


class UserinfoFetchError(AuthError):
    """GET /oauth/userinfo failed."""


class RevokeFailedError(AuthError):
    """POST /oauth/revoke failed. Always best-effort — never fatal."""
