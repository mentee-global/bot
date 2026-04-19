from typing import Annotated

from pydantic import AnyHttpUrl, BeforeValidator, SecretStr
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _split_csv(value: str | list[str]) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Environment
    environment: str = "local"
    frontend_url: AnyHttpUrl = AnyHttpUrl("http://localhost:3001")
    cors_origins: Annotated[list[AnyHttpUrl], NoDecode, BeforeValidator(_split_csv)] = [
        AnyHttpUrl("http://localhost:3001"),
    ]

    # OAuth client registration (issued by Mentee — see docs/oauth/00-oauth-overview.md §2.6)
    mentee_oauth_issuer: AnyHttpUrl = AnyHttpUrl("http://localhost:8000")
    mentee_oauth_client_id: str = "mentee-bot-local"
    mentee_oauth_client_secret: SecretStr
    mentee_oauth_redirect_uri: AnyHttpUrl = AnyHttpUrl(
        "http://localhost:8001/api/auth/callback"
    )
    mentee_oauth_scopes: str = "openid email profile mentee.role"

    # Database — Postgres everywhere
    database_url: str = "postgresql+asyncpg://bot:bot@localhost:5432/bot_dev"

    # Session encryption + cookie
    session_secret: SecretStr
    session_cookie_name: str = "mentee_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"
    session_max_age_seconds: int = 60 * 60 * 24 * 7

    # OAuth transient state
    oauth_state_ttl_seconds: int = 600

    @property
    def is_prod(self) -> bool:
        return self.environment == "production"


settings = Settings()
