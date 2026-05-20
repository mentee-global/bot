"""Diagnose bot-side auth state for specific users.

For each email:
- whether they exist in `users` (i.e. ever completed an OAuth callback)
- active sessions and their token expiry
- whether any `oauth_state` rows are sitting around unconsumed for them
  (can't be tied to a specific user — emitted as a global summary)

Plus a global recent-activity count: how many OAuth `state` rows were created
in the last 24h vs. how many were popped (consumed by a callback).

    uv run python backend/scripts/inspect_user_auth.py \\
        melikazahrarasoli@gmail.com mnsasiira@fh.org
"""
import asyncio
import os
import sys
from datetime import UTC, datetime, timedelta

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.normpath(os.path.join(_HERE, os.pardir))
load_dotenv(os.path.join(_BACKEND, ".env"))


def _short(v, n=8):
    if v is None:
        return None
    s = str(v)
    return s if len(s) <= n else s[:n] + "…"


async def _inspect_user(conn, email: str) -> None:
    print(f"\n== User: {email} ==")
    row = (
        await conn.execute(
            text(
                "SELECT id, mentee_sub, email, name, role, role_id, "
                "preferred_language, created_at, updated_at "
                "FROM users WHERE email = :e"
            ),
            {"e": email},
        )
    ).mappings().first()
    if row is None:
        print("  NOT FOUND in users table")
        print("  -> User has NEVER completed an OAuth callback on the bot")
        return
    print(f"  id: {row['id']}")
    print(f"  mentee_sub: {row['mentee_sub']!r}")
    print(f"  name: {row['name']!r}")
    print(f"  role: {row['role']!r} (role_id={row['role_id']})")
    print(f"  preferred_language: {row['preferred_language']!r}")
    print(f"  created_at: {row['created_at']}  updated_at: {row['updated_at']}")

    sessions = (
        await conn.execute(
            text(
                "SELECT session_id, access_token_expires_at, "
                "created_at, last_used_at "
                "FROM sessions WHERE user_id = :uid "
                "ORDER BY last_used_at DESC"
            ),
            {"uid": row["id"]},
        )
    ).mappings().all()
    if not sessions:
        print("  Sessions: none — last completed login (if any) has been deleted")
        return
    print(f"  Sessions: {len(sessions)} total")
    now = datetime.now(UTC)
    for s in sessions[:5]:
        exp = s["access_token_expires_at"]
        expired = " (access-token EXPIRED)" if exp <= now else ""
        print(
            f"    {_short(s['session_id'])} "
            f"created {s['created_at']:%Y-%m-%d %H:%M} "
            f"last_used {s['last_used_at']:%Y-%m-%d %H:%M} "
            f"access_exp {exp:%Y-%m-%d %H:%M}{expired}"
        )


async def _orphan_state_summary(conn) -> None:
    print("\n== oauth_state activity (last 24h) ==")
    horizon = datetime.now(UTC) - timedelta(hours=24)
    created = (
        await conn.execute(
            text(
                "SELECT COUNT(*) AS n FROM oauth_state WHERE created_at >= :h"
            ),
            {"h": horizon},
        )
    ).scalar_one()
    pending_unexpired = (
        await conn.execute(
            text(
                "SELECT COUNT(*) AS n FROM oauth_state "
                "WHERE created_at >= :h AND expires_at > now()"
            ),
            {"h": horizon},
        )
    ).scalar_one()
    pending_expired = (
        await conn.execute(
            text(
                "SELECT COUNT(*) AS n FROM oauth_state "
                "WHERE created_at >= :h AND expires_at <= now()"
            ),
            {"h": horizon},
        )
    ).scalar_one()
    print(f"  state rows still in table (created in window): {created}")
    print(f"    pending (not yet expired): {pending_unexpired}")
    print(f"    expired but uncollected:   {pending_expired}")
    print(
        "  Note: a 'pop' on callback deletes the row, so anything still here is "
        "either a callback that hasn't arrived yet or one that never will (=> "
        "user got bounced before Mentee redirected back to /api/auth/callback)."
    )


async def main(emails: list[str]) -> None:
    url = os.environ["DATABASE_URL"]
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        print(f"Connected to bot Postgres")
        for email in emails:
            await _inspect_user(conn, email)
        await _orphan_state_summary(conn)
    await engine.dispose()


if __name__ == "__main__":
    args = sys.argv[1:] or [
        "melikazahrarasoli@gmail.com",
        "mnsasiira@fh.org",
    ]
    asyncio.run(main(args))
