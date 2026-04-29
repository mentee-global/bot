"""v2 runner — same shape as eval_run.py but uses the v2 prompt corpus,
writes to eval_results_v2.jsonl, and captures tool-call names per run so we
can measure dual-source reconciliation rate.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

from app.agents.mentee.agent import _strip_citations
from app.agents.mentee.clai_agent import agent
from scripts.eval_prompts_v2 import PROMPTS, EvalPrompt

RESULTS_PATH = Path(__file__).parent / "eval_results_v2.jsonl"


def _load_done_ids() -> set[int]:
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


def _extract_tool_calls(result) -> list[str]:
    calls: list[str] = []
    for m in result.all_messages():
        for part in getattr(m, "parts", []) or []:
            name = type(part).__name__
            tool = getattr(part, "tool_name", None) or getattr(part, "name", None)
            if tool and "ToolCall" in name:
                calls.append(str(tool))
    return calls


PER_RUN_TIMEOUT_S = 90.0


async def _run_one(p: EvalPrompt, sem: asyncio.Semaphore) -> dict:
    async with sem:
        t0 = time.perf_counter()
        attempt = 0
        while True:
            attempt += 1
            try:
                result = await asyncio.wait_for(
                    agent.run(p.prompt), timeout=PER_RUN_TIMEOUT_S
                )
                return {
                    "id": p.id,
                    "category": p.category,
                    "prompt": p.prompt,
                    "expect": p.expect,
                    "output": _strip_citations(result.output),
                    "tool_calls": _extract_tool_calls(result),
                    "elapsed_s": round(time.perf_counter() - t0, 2),
                    "attempts": attempt,
                    "ok": True,
                }
            except TimeoutError:
                return {
                    "id": p.id,
                    "category": p.category,
                    "prompt": p.prompt,
                    "expect": p.expect,
                    "error": f"TimeoutError: >{PER_RUN_TIMEOUT_S}s",
                    "elapsed_s": round(time.perf_counter() - t0, 2),
                    "attempts": attempt,
                    "ok": False,
                }
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                # Cap retries so a single prompt can't monopolise a slot.
                if "rate_limit_exceeded" in msg and attempt < 3:
                    await asyncio.sleep(min(2 ** attempt, 10))
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
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    done = set() if args.force else _load_done_ids()
    todo = [
        p
        for p in PROMPTS
        if (args.ids is None or p.id in args.ids) and p.id not in done
    ]
    if not todo:
        print("nothing to run")
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
        calls = ",".join(rec.get("tool_calls", [])) if rec.get("ok") else ""
        preview = (rec.get("output") or rec.get("error") or "")[:70].replace("\n", " ")
        print(
            f"[{completed:3d}/{len(todo)}] #{rec['id']:3d} {rec['category']:18s} {status} "
            f"{rec['elapsed_s']:5.1f}s [{calls}]  {preview}"
        )


if __name__ == "__main__":
    asyncio.run(main())
