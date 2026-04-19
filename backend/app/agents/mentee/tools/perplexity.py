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

from perplexity import AsyncPerplexity


@dataclass(slots=True, frozen=True)
class PerplexityAnswer:
    answer: str
    citations: list[str]


async def call_perplexity(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    model: str = "sonar-pro",
    timeout_s: float = 25.0,
) -> PerplexityAnswer:
    """Run a single grounded Perplexity query. Raises the SDK's typed errors
    (`APIStatusError`, `APITimeoutError`, `APIConnectionError`) on failure —
    callers map those to their own error envelopes.
    """
    async with AsyncPerplexity(api_key=api_key, timeout=timeout_s) as client:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )

    answer = ""
    if response.choices:
        message = response.choices[0].message
        if message and message.content:
            answer = str(message.content)

    citations = list(response.citations) if response.citations else []
    return PerplexityAnswer(answer=answer, citations=citations)
