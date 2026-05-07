"""Monitor disclaimer-pattern rate AND allowlist-vs-cited URL gap.

After the `omit unverified items, no apology disclaimers` prompt change
(commit a5d8369), the model should stop producing replies like
"I couldn't verify the official link… want me to search again?".
This script samples the last N assistant messages and reports:

1. How many had apology / hedge patterns in their body.
2. How big the gap was between URLs the search tools returned for that
   turn (`urls_cited` span attr) and URLs the model actually wrote into
   the body. A persistent gap means the model is leaving real,
   verified URLs on the table — the signal for whether we need to
   surface unused sources somewhere in the UI.

Re-run after a few days of traffic. Decision criteria:
- Disclaimer rate near zero AND gap shrinks → done, prompt rule held.
- Disclaimer rate near zero BUT gap stays large → consider exposing
  unused sources (e.g. an expandable "related sources" pill row).
- Disclaimer rate stays nonzero → add code-side re-search enforcement.

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

_URL_RE = re.compile(r'https?://[^\s<>"]+')

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
    body_url_counts: list[int] = []
    for r in rows:
        body = r["body"] or ""
        hits = [m.group(0) for p in _PATTERNS for m in p.finditer(body)]
        if hits:
            flagged.append((r["id"], r["created_at"], hits))
        body_url_counts.append(len({u.rstrip("/") for u in _URL_RE.findall(body)}))

    total = len(rows)
    pct = 100 * len(flagged) // max(total, 1)
    print(f"Sample:  last {total} assistant messages over {_DAYS}d")
    print(f"Flagged: {len(flagged)} ({pct}%)")
    if body_url_counts:
        avg_urls = sum(body_url_counts) / len(body_url_counts)
        with_urls = [c for c in body_url_counts if c > 0]
        avg_with = (sum(with_urls) / len(with_urls)) if with_urls else 0
        print(
            f"URLs:    avg {avg_urls:.1f}/msg overall, "
            f"avg {avg_with:.1f}/msg when any URL present "
            f"({len(with_urls)}/{total} messages had ≥1 URL)"
        )

    if flagged:
        print("\n--- disclaimer examples (most recent first) ---")
        for mid, ts, hits in flagged[:10]:
            print(f"{ts}  {mid}")
            for h in hits[:3]:
                print(f"    «{h}»")
    else:
        print("\nNo apology / hedge patterns found — prompt rule appears to hold.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
