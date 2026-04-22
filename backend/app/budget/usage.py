"""Mutable collectors the agent fills during a run so the service layer can
write a per-turn usage ledger after the reply completes.

Kept separate from pydantic-ai's own `Usage` because tool calls we make
ourselves (Perplexity HTTP) aren't observable through pydantic-ai — and the
web_search builtin doesn't expose per-call token cost in a stable shape.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PerplexityCall:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class UsageSummary:
    """Filled by the agent during a turn, read by the service to charge credits."""

    openai_input_tokens: int = 0
    openai_output_tokens: int = 0
    perplexity_calls: list[PerplexityCall] = field(default_factory=list)
    web_search_calls: int = 0

    def record_perplexity(self, *, input_tokens: int, output_tokens: int) -> None:
        self.perplexity_calls.append(
            PerplexityCall(
                input_tokens=input_tokens, output_tokens=output_tokens
            )
        )

    def inc_web_search(self) -> None:
        self.web_search_calls += 1
