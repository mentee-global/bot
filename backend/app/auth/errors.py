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
    """Provider returned `unsupported_grant_type` on refresh.

    Should not happen in normal operation now that Mentee's
    MenteeRefreshTokenGrant is registered. If it fires, treat as a provider
    regression (log at WARNING, page if persistent).
    """


class RefreshInvalidGrantError(RefreshFailedError):
    """Provider returned `invalid_grant` on refresh.

    Means the refresh token is no longer redeemable: token rotation already
    happened (replay-detected and family burned), token was revoked (admin
    action, password reset, user-initiated revoke from Connected Apps), or
    the user's `token_version` was bumped. Caller should delete the session
    and force re-auth. Log at INFO — this is a normal end-of-session event.
    """


class UserinfoFetchError(AuthError):
    """GET /oauth/userinfo failed."""


class RevokeFailedError(AuthError):
    """POST /oauth/revoke failed. Always best-effort — never fatal."""


class ProfileFetchAuthError(AuthError):
    """GET /oauth/profile returned 401. Caller should refresh and retry."""
