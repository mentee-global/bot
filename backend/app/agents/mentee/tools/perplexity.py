"""Thin wrapper over the official Perplexity SDK.

Uses `AsyncPerplexity` from the `perplexityai` package. We expose a single
`call_perplexity` helper that returns a small dataclass with the two fields
the tool actually cares about — answer text + citation URLs. Everything else
(SDK-level retries, timeouts, auth, error classes) is left to the SDK.

Logfire already instruments httpx globally, and the SDK uses httpx underneath,
so every Perplexity call shows up as a span without extra wiring.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from perplexity import AsyncPerplexity

# Perplexity Sonar's native server-side recency filter. `month` is the default
# for mentee questions (most queries are scholarships/programs/visa rules that
# don't change daily). `week` is the right pick for news and deadlines that
# might have moved recently. `day`/`hour` are for breaking news. `year` is
# the longest-lookback option for stable long-tail facts.
PerplexityRecency = Literal["hour", "day", "week", "month", "year"]


@dataclass(slots=True, frozen=True)
class PerplexityAnswer:
    answer: str
    citations: list[str]
    input_tokens: int = 0
    output_tokens: int = 0


async def call_perplexity(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    model: str = "sonar-pro",
    timeout_s: float = 25.0,
    recency: PerplexityRecency | None = "month",
) -> PerplexityAnswer:
    """Run a single grounded Perplexity query. Raises the SDK's typed errors
    (`APIStatusError`, `APITimeoutError`, `APIConnectionError`) on failure —
    callers map those to their own error envelopes.
    """
    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if recency is not None:
        kwargs["search_recency_filter"] = recency
    async with AsyncPerplexity(api_key=api_key, timeout=timeout_s) as client:
        response = await client.chat.completions.create(**kwargs)

    answer = ""
    if response.choices:
        message = response.choices[0].message
        if message and message.content:
            answer = str(message.content)

    citations = list(response.citations) if response.citations else []
    # Usage fields are optional on the Perplexity SDK; default to 0 so the
    # budget ledger still records the request fee even if tokens are missing.
    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0
    output_tokens = int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0
    return PerplexityAnswer(
        answer=answer,
        citations=citations,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
