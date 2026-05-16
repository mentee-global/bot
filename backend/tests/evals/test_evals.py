"""Pytest entry point: `uv run pytest tests/evals -m eval`.

Runs the same dataset as `run_baseline.py` but writes results into a
timestamped file under `results/`, so a `pytest` invocation doesn't
silently overwrite the committed baseline.

The test asserts only that the runner produced a result for every case
(no agent crashes). Score thresholds are deliberately NOT asserted
here — evals are measurement infrastructure, not pass/fail gates. The
plan is to compare aggregates between runs at code-review time, not to
block CI on absolute scores.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest

from .dataset import mentee_cases
from .run_baseline import _run


@pytest.mark.eval
def test_run_full_eval_suite() -> None:
    """Run all cases against the live agent and assert each produced a
    result. Result JSON is written for review.
    """
    expected_case_count = len(mentee_cases())
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = Path(__file__).parent / "results" / f"run_{timestamp}.json"
    result = asyncio.run(_run(output, concurrency=1))
    assert result["case_count"] == expected_case_count
    assert len(result["cases"]) == expected_case_count
    # Spot check: every case has at least one evaluator score recorded.
    for case in result["cases"]:
        assert case["scores"], f"case {case['name']!r} produced no scores"
