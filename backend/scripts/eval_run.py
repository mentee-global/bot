"""Run the 100-prompt eval against the clai mentor agent.

Checkpointed: writes each result to `scripts/eval_results.jsonl` as it finishes,
and on re-run skips ids already present. Bounded concurrency so we don't melt
OpenAI/Perplexity rate limits.

Usage:
    uv run python scripts/eval_run.py                 # run all missing
    uv run python scripts/eval_run.py --ids 1 2 3     # only these
    uv run python scripts/eval_run.py --concurrency 3 # override default
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

from app.agents.mentee.agent import _strip_citations
from app.agents.mentee.clai_agent import agent
from scripts.eval_prompts import PROMPTS, EvalPrompt

RESULTS_PATH = Path(__file__).parent / "eval_results.jsonl"


def _load_done_ids() -> set[int]:
    """Successful ids only — errored rows are redo-able on next run."""
    if not RESULTS_PATH.exists():
        return set()
    done: set[int] = set()
    for line in RESULTS_PATH.read_text().splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(rec, dict) and rec.get("ok") and "id" in rec:
            done.add(int(rec["id"]))
    return done


async def _run_one(p: EvalPrompt, sem: asyncio.Semaphore) -> dict:
    async with sem:
        t0 = time.perf_counter()
        attempt = 0
        while True:
            attempt += 1
            try:
                result = await agent.run(p.prompt)
                cleaned = _strip_citations(result.output)
                return {
                    "id": p.id,
                    "category": p.category,
                    "prompt": p.prompt,
                    "expect": p.expect,
                    "output": cleaned,
                    "elapsed_s": round(time.perf_counter() - t0, 2),
                    "attempts": attempt,
                    "ok": True,
                }
            except Exception as exc:  # noqa: BLE001 — capture & continue
                msg = str(exc)
                # OpenAI TPM rate limits are transient; back off and retry.
                if "rate_limit_exceeded" in msg and attempt < 6:
                    await asyncio.sleep(min(2 ** attempt, 20))
                    continue
                return {
                    "id": p.id,
                    "category": p.category,
                    "prompt": p.prompt,
                    "expect": p.expect,
                    "error": f"{type(exc).__name__}: {msg}",
                    "elapsed_s": round(time.perf_counter() - t0, 2),
                    "attempts": attempt,
                    "ok": False,
                }


def _append_result(rec: dict) -> None:
    with RESULTS_PATH.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        f.flush()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", type=int, nargs="*", default=None)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--force", action="store_true", help="re-run even if already saved")
    args = ap.parse_args()

    done = set() if args.force else _load_done_ids()
    todo = [
        p
        for p in PROMPTS
        if (args.ids is None or p.id in args.ids) and p.id not in done
    ]
    if not todo:
        print("nothing to run — all prompts already have results")
        return

    print(f"running {len(todo)} prompts with concurrency={args.concurrency}")
    sem = asyncio.Semaphore(args.concurrency)
    tasks = [asyncio.create_task(_run_one(p, sem)) for p in todo]

    completed = 0
    for coro in asyncio.as_completed(tasks):
        rec = await coro
        _append_result(rec)
        completed += 1
        status = "OK" if rec.get("ok") else "ERR"
        preview = (rec.get("output") or rec.get("error") or "")[:80].replace("\n", " ")
        print(f"[{completed:3d}/{len(todo)}] #{rec['id']:3d} {rec['category']:12s} {status} {rec['elapsed_s']:5.1f}s  {preview}")


if __name__ == "__main__":
    asyncio.run(main())
