"""Cost math driven entirely by `BudgetConfig` so an admin edit takes effect
on the very next turn.

All monetary values are integer micros of USD (USD × 1_000_000) — integers
instead of floats so sums over tens of thousands of turns don't drift.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.budget.db_models import BudgetConfig
from app.budget.usage import UsageSummary


@dataclass(frozen=True)
class CostBreakdown:
    openai_micros: int
    perplexity_micros: int
    web_search_micros: int

    @property
    def total_micros(self) -> int:
        return self.openai_micros + self.perplexity_micros + self.web_search_micros


def _tokens_to_micros(tokens: int, per_mtok_micros: int) -> int:
    # per_mtok_micros is per 1_000_000 tokens; scale linearly.
    return (tokens * per_mtok_micros) // 1_000_000


def compute_cost(usage: UsageSummary, cfg: BudgetConfig) -> CostBreakdown:
    openai_micros = _tokens_to_micros(
        usage.openai_input_tokens, cfg.pricing_openai_input_per_mtok_micros
    ) + _tokens_to_micros(
        usage.openai_output_tokens, cfg.pricing_openai_output_per_mtok_micros
    )

    perplexity_micros = 0
    for call in usage.perplexity_calls:
        perplexity_micros += _tokens_to_micros(
            call.input_tokens, cfg.pricing_perplexity_input_per_mtok_micros
        )
        perplexity_micros += _tokens_to_micros(
            call.output_tokens, cfg.pricing_perplexity_output_per_mtok_micros
        )
        perplexity_micros += cfg.pricing_perplexity_request_fee_micros

    web_search_micros = (
        usage.web_search_calls * cfg.pricing_web_search_per_call_micros
    )
    return CostBreakdown(
        openai_micros=openai_micros,
        perplexity_micros=perplexity_micros,
        web_search_micros=web_search_micros,
    )


def micros_to_credits(micros: int, credit_value_micros: int) -> int:
    """Round UP so a $0.0001 turn never shows as free — protects the budget
    against death-by-rounding under very high turn counts.
    """
    if credit_value_micros <= 0:
        return 0
    # ceil(micros / credit_value_micros)
    return max(1, (micros + credit_value_micros - 1) // credit_value_micros) if micros > 0 else 0
