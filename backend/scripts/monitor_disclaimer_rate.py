"""Monitor the disclaimer-pattern rate in recent assistant messages.

After the `omit unverified items, no apology disclaimers` prompt change
(commit a5d8369), the model should stop producing replies like
"I couldn't verify the official link… want me to search again?".
This script samples the last N assistant messages, flags any matching
the apology / hedge patterns, and prints the rate plus example hits.

Re-run after a few days of real traffic to confirm the rate trended
down. If it hasn't, that's the signal to add code-side enforcement
(force a re-search when the model is about to skip an item).

Run from `backend/`: PYTHONPATH=. uv run python scripts/monitor_disclaimer_rate.py
"""

from __future__ import annotations

import asyncio
import os
import re
import sys

import asyncpg
from dotenv import load_dotenv

load_dotenv()

_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"couldn['’]?t verify", re.IGNORECASE),
    re.compile(r"I don['’]?t have the official", re.IGNORECASE),
    re.compile(r"want me to search", re.IGNORECASE),
    re.compile(r"I can search again", re.IGNORECASE),
    re.compile(r"haven['’]?t verified", re.IGNORECASE),
    re.compile(r"not (?:able to|been able to) verify", re.IGNORECASE),
)
# Look-back window. Tune via the LIMIT/INTERVAL constants if you want
# a tighter / looser sample.
_DAYS = 7
_LIMIT = 200


async def main() -> int:
    raw_url = os.environ.get("DATABASE_URL")
    if not raw_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 1
    pg_url = raw_url.replace("+asyncpg", "").replace(
        "postgresql+asyncpg", "postgresql"
    )

    conn = await asyncpg.connect(pg_url)
    try:
        rows = await conn.fetch(
            f"""
            SELECT id, body, created_at
            FROM messages
            WHERE role = 'assistant'
              AND created_at > NOW() - INTERVAL '{_DAYS} days'
            ORDER BY created_at DESC
            LIMIT {_LIMIT}
            """
        )
    finally:
        await conn.close()

    flagged: list[tuple[object, object, list[str]]] = []
    for r in rows:
        body = r["body"] or ""
        hits = [m.group(0) for p in _PATTERNS for m in p.finditer(body)]
        if hits:
            flagged.append((r["id"], r["created_at"], hits))

    total = len(rows)
    pct = 100 * len(flagged) // max(total, 1)
    print(f"Sample:  last {total} assistant messages over {_DAYS}d")
    print(f"Flagged: {len(flagged)} ({pct}%)")
    if not flagged:
        print("\nNo apology / hedge patterns found — prompt rule appears to hold.")
        return 0

    print("\n--- examples (most recent first) ---")
    for mid, ts, hits in flagged[:10]:
        print(f"{ts}  {mid}")
        for h in hits[:3]:
            print(f"    «{h}»")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
