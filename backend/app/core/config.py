from typing import Annotated, Literal

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
    mentee_oauth_scopes: str = (
        "openid email profile mentee.role mentee.api.profile.read"
    )

    # TTL for the per-session cache in AuthService that holds the richer
    # profile fetched from Mentee's /oauth/profile endpoint.
    # See docs/oauth/04-mentee-api-profile.md.
    bot_profile_cache_ttl_seconds: int = 15 * 60

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

    # Thread persistence
    store_impl: Literal["memory", "postgres"] = "memory"

    # Agent
    openai_api_key: SecretStr | None = None
    # Separate admin-scoped key for the /v1/organization/costs endpoint —
    # generated at platform.openai.com/settings/organization/admin-keys. Leave
    # unset to skip provider-side spend pulls and show "not available" in UI.
    openai_admin_api_key: SecretStr | None = None
    perplexity_api_key: SecretStr | None = None
    perplexity_model: str = "sonar"
    agent_impl: Literal["mock", "mentee"] = "mock"
    agent_model: str = "gpt-5.4-mini"
    agent_request_timeout_s: float = 30.0
    agent_request_limit: int = 10
    agent_total_tokens_limit: int = 32_000
    agent_enable_web_search: bool = True

    # Observability
    logfire_token: SecretStr | None = None
    logfire_service_name: str = "mentee-bot"
    logfire_send_to_cloud: bool = False
    logfire_capture_message_body: bool = False

    # Outbound email — used to alert juan/letitia about new bug reports and
    # credit requests. Optional: when sendgrid_api_key is unset, the create
    # endpoints still persist to DB but flag the row with email_error.
    sendgrid_api_key: SecretStr | None = None
    sender_email: str | None = None  # e.g. "Mentee Bot <bot@menteeglobal.org>"
    admin_alert_recipients: Annotated[
        list[str], NoDecode, BeforeValidator(_split_csv)
    ] = [
        "juan@menteeglobal.org",
        "letitia@menteeglobal.org",
    ]

    @property
    def is_prod(self) -> bool:
        return self.environment == "production"


settings = Settings()
