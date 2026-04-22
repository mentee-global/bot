"""Provider-side spend pulls: the real numbers from OpenAI / Perplexity.

Our ledger (`global_budget_state`) is authoritative for quota enforcement
because it updates in real-time and never fails. This module is for
*reconciliation*: admin wants to compare what we think we spent against what
the provider's billing system agrees we spent.

- OpenAI exposes `GET /v1/organization/costs` (requires a separate Admin Key).
- Perplexity has no public usage endpoint — we surface `available=False`
  with a pointer to the dashboard.

Results are cached in-process for 5 minutes so dashboard refreshes don't hit
OpenAI on every page load. The cache is busted on admin demand via the `?refresh=1`
query on the endpoint.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

_OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs"
_CACHE_TTL_S = 300.0  # 5 min


@dataclass
class ProviderSpend:
    provider: str
    available: bool
    period_start: datetime | None = None
    spend_micros: int = 0
    currency: str = "usd"
    reason: str | None = None
    dashboard_url: str | None = None
    fetched_at: datetime | None = None
    ledger_spend_micros: int | None = None  # filled by the caller


@dataclass
class _CacheEntry:
    expires_at: float
    value: ProviderSpend


_cache: dict[str, _CacheEntry] = {}


def _month_start_unix(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    start = datetime(now.year, now.month, 1, tzinfo=UTC)
    return int(start.timestamp())


async def _fetch_openai_costs(
    api_key: str, start_unix: int, timeout_s: float = 15.0
) -> ProviderSpend:
    """Sum all bucket amounts for the current month. Returns a spend snapshot."""
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {
        "start_time": start_unix,
        "bucket_width": "1d",
        "limit": 31,
    }
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.get(_OPENAI_COSTS_URL, params=params, headers=headers)
    if resp.status_code == 401:
        return ProviderSpend(
            provider="openai",
            available=False,
            reason="OpenAI rejected the admin key (401). Regenerate it in the "
            "org admin console and retry.",
            dashboard_url="https://platform.openai.com/settings/organization/usage",
        )
    if resp.status_code == 403:
        return ProviderSpend(
            provider="openai",
            available=False,
            reason="OpenAI admin key lacks the `api.usage.read` scope.",
            dashboard_url="https://platform.openai.com/settings/organization/usage",
        )
    resp.raise_for_status()
    payload = resp.json()
    # Response is a page of daily buckets; each has a `results` list of
    # org.costs.result entries with `{amount: {value, currency}}`.
    total_usd = 0.0
    currency = "usd"
    for bucket in payload.get("data", []):
        for result in bucket.get("results", []) or []:
            amount = result.get("amount") or {}
            val = amount.get("value")
            cur = amount.get("currency")
            # OpenAI returns `value` as either a number or a high-precision
            # decimal string — handle both.
            if isinstance(val, (int, float)):
                total_usd += float(val)
            elif isinstance(val, str):
                try:
                    total_usd += float(val)
                except ValueError:
                    logger.warning("openai costs: non-numeric value %r", val)
            if cur:
                currency = cur
    return ProviderSpend(
        provider="openai",
        available=True,
        period_start=datetime.fromtimestamp(start_unix, tz=UTC),
        spend_micros=int(round(total_usd * 1_000_000)),
        currency=currency,
        dashboard_url="https://platform.openai.com/settings/organization/usage",
        fetched_at=datetime.now(UTC),
    )


async def get_openai_spend(
    settings: Settings, *, refresh: bool = False
) -> ProviderSpend:
    key = "openai"
    now = time.monotonic()
    if not refresh and key in _cache and _cache[key].expires_at > now:
        return _cache[key].value

    if settings.openai_admin_api_key is None:
        result = ProviderSpend(
            provider="openai",
            available=False,
            reason=(
                "OPENAI_ADMIN_API_KEY is not configured. Add an admin key from "
                "the OpenAI org console to pull real spend here."
            ),
            dashboard_url="https://platform.openai.com/settings/organization/usage",
        )
    else:
        try:
            result = await _fetch_openai_costs(
                settings.openai_admin_api_key.get_secret_value(),
                _month_start_unix(),
            )
        except httpx.HTTPError as exc:
            logger.warning("openai costs fetch failed: %s", exc)
            result = ProviderSpend(
                provider="openai",
                available=False,
                reason=f"Provider request failed: {exc.__class__.__name__}.",
                dashboard_url="https://platform.openai.com/settings/organization/usage",
            )

    _cache[key] = _CacheEntry(expires_at=now + _CACHE_TTL_S, value=result)
    return result


async def get_perplexity_spend(_settings: Settings) -> ProviderSpend:
    # Perplexity doesn't expose a programmatic usage endpoint. The only
    # authoritative source is the web dashboard — point the admin at it.
    return ProviderSpend(
        provider="perplexity",
        available=False,
        reason=(
            "Perplexity does not expose a usage / balance API. Use the "
            "dashboard to confirm billing."
        ),
        dashboard_url="https://www.perplexity.ai/settings/api",
    )
