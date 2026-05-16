"""Standalone runner: execute the eval dataset and write a JSON report.

Usage:
    uv run python -m tests.evals.run_baseline
    uv run python -m tests.evals.run_baseline --output results/my_run.json
    uv run python -m tests.evals.run_baseline --concurrency 4

The output JSON has a stable, easy-to-diff shape: per-case scores keyed
by evaluator name plus the aggregate row, embedded telemetry
(`tools_fired`, `citations_count`, `citations_titled`), and a short
excerpt of the response body so reviewers can sanity-check that the
agent actually ran without re-reading the chat.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import logfire
from pydantic_evals import Dataset

from app.core.config import settings as default_settings

from .dataset import (
    MenteeInput,
    MenteeMetadata,
    MenteeOutput,
    mentee_cases,
)
from .evaluators import default_evaluators
from .runner import run_mentee


def _configure_logfire() -> None:
    """Mirror `app.main._configure_logfire` so eval spans ship to Logfire.

    Lets the user see each eval case as a normal trace under `/live`.
    Doesn't populate `/live-evals` — that tab requires the separate
    `OnlineEvaluation` integration which we're not wiring here.
    """
    has_token = default_settings.logfire_token is not None
    logfire.configure(
        service_name=f"{default_settings.logfire_service_name}-evals",
        environment="eval",
        send_to_logfire=has_token,
        token=(
            default_settings.logfire_token.get_secret_value() if has_token else None
        ),
    )
    logfire.instrument_pydantic_ai(include_content=True)
    logfire.instrument_openai()
    logfire.instrument_httpx()


def _git_sha() -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=Path(__file__).resolve().parents[2],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            .strip()
        )
    except Exception:  # noqa: BLE001 — best-effort metadata
        return "unknown"


def _build_dataset(
    case_filter: list[str] | None = None,
) -> Dataset[MenteeInput, MenteeOutput, MenteeMetadata]:
    all_cases = list(mentee_cases())
    if case_filter:
        selected = [c for c in all_cases if c.name in case_filter]
        missing = set(case_filter) - {c.name for c in selected}
        if missing:
            raise SystemExit(
                f"Unknown case name(s) in --cases: {sorted(missing)}. "
                f"Available: {sorted(c.name for c in all_cases)}"
            )
        cases = selected
    else:
        cases = all_cases
    return Dataset[MenteeInput, MenteeOutput, MenteeMetadata](
        name="mentee-bot-baseline",
        cases=cases,
        evaluators=default_evaluators(),
    )


async def _run(
    output_path: Path,
    concurrency: int,
    case_filter: list[str] | None = None,
) -> dict[str, Any]:
    """Run the dataset (optionally filtered by case name), then
    serialize results into a flat JSON shape that's easy to diff
    across runs.
    """
    dataset = _build_dataset(case_filter=case_filter)
    report = await dataset.evaluate(
        run_mentee,
        max_concurrency=concurrency,
        progress=True,
    )

    cases_out: list[dict[str, Any]] = []
    for case_result in report.cases:
        scores: dict[str, Any] = {}
        # Boolean assertions are rare for us (all evaluators return floats
        # or dicts of floats), but keep the channel so future bool checks
        # surface cleanly.
        for name, assertion in case_result.assertions.items():
            scores[name] = bool(assertion.value)
        for name, score in case_result.scores.items():
            scores[name] = score.value
        body = ""
        tools_fired: list[str] = []
        citations_count = 0
        citations_titled = 0
        if case_result.output is not None:
            body = case_result.output.body[:600]
            tools_fired = list(case_result.output.tools_fired)
            citations_count = case_result.output.citations_count
            citations_titled = case_result.output.citations_titled
        cases_out.append(
            {
                "name": case_result.name,
                "scores": scores,
                "response_excerpt": body,
                "tools_fired": tools_fired,
                "citations_count": citations_count,
                "citations_titled": citations_titled,
                "duration_s": case_result.task_duration,
            }
        )

    # Capture task-execution failures so a silent error during the agent
    # call doesn't just disappear from the report. We treat any failure
    # as actionable signal — the eval shouldn't gracefully mask bugs.
    failures_out: list[dict[str, Any]] = []
    for failure in report.failures:
        failures_out.append(
            {
                "name": failure.name,
                "error_message": failure.error_message,
                "error_stacktrace_excerpt": (failure.error_stacktrace or "")[:2000],
            }
        )

    avg = report.averages()
    aggregates: dict[str, float | None] = {}
    if avg.assertions is not None:
        # `assertions` is a single pass-rate across all bool assertions in
        # the run. We expose it under a sentinel key so downstream tooling
        # can still find it.
        aggregates["_assertions_pass_rate"] = avg.assertions
    for name, value in avg.scores.items():
        aggregates[name] = value

    out = {
        "ran_at": datetime.now(UTC).isoformat(),
        "git_sha": _git_sha(),
        "agent_model": default_settings.agent_model,
        "case_count": len(cases_out),
        "failure_count": len(failures_out),
        "cases": cases_out,
        "failures": failures_out,
        "aggregates": aggregates,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Mentee agent eval suite.")
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    default_output = (
        Path(__file__).parent / "results" / f"baseline_{today}.json"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help="Path to write the run's JSON report.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help=(
            "Max concurrent cases. Default 1 because OpenAI's TPM limit "
            "(~200K) bites with our prompt + history sizes; even "
            "concurrency=2 produces 429s. Raise only if you've bumped "
            "the org's rate limit."
        ),
    )
    parser.add_argument(
        "--cases",
        type=str,
        default=None,
        help=(
            "Comma-separated list of case names to run, instead of the "
            "full 26-case suite. Useful for tuning one case in seconds "
            "instead of minutes. Example: "
            "--cases learning_path_ai_engineer_en,test_prep_ielts_es"
        ),
    )
    args = parser.parse_args()
    case_filter = (
        [c.strip() for c in args.cases.split(",") if c.strip()]
        if args.cases
        else None
    )
    _configure_logfire()
    result = asyncio.run(_run(args.output, args.concurrency, case_filter))
    print(f"\nWrote {args.output}")
    print(f"Aggregate scores: {json.dumps(result['aggregates'], indent=2)}")


if __name__ == "__main__":
    main()
