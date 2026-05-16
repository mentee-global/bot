"""Pytest configuration for the Mentee agent eval suite.

Evals exercise the real OpenAI + Perplexity APIs. They are marked
`eval` so the regular test pass can skip them, and they self-skip when
the required API keys are absent so a contributor without those keys
can still run the rest of the suite.
"""

from __future__ import annotations

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "eval: end-to-end evaluation against live LLM APIs"
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Auto-skip eval tests when the required API keys are missing.

    Reads through `app.core.config.settings` (not raw env) so the keys
    in `backend/.env` count — `pydantic-settings` resolves them at
    import time. This keeps the eval directory cheap to discover and
    avoids surfacing auth failures as test failures when a contributor
    has no keys set.
    """
    from app.core.config import settings

    missing: list[str] = []
    if settings.openai_api_key is None:
        missing.append("OPENAI_API_KEY")
    if settings.perplexity_api_key is None:
        missing.append("PERPLEXITY_API_KEY")
    if not missing:
        return
    skip = pytest.mark.skip(reason=f"missing config: {', '.join(missing)}")
    for item in items:
        if "eval" in item.keywords:
            item.add_marker(skip)
