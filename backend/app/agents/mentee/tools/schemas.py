import json
from typing import Any


def insufficient_context(missing_fields: list[str], message: str) -> str:
    """Standard shape every tool returns when it can't execute.

    The model is instructed to read this and ask the mentee for the missing
    field instead of guessing or calling the tool with placeholders.
    """
    return json.dumps(
        {
            "status": "insufficient_context",
            "missing_fields": missing_fields,
            "message": message,
        }
    )


def ok(payload: dict[str, Any]) -> str:
    return json.dumps({"status": "ok", **payload})
