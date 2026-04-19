"""Stream events yielded by `AgentPort.stream_reply`.

A single `AsyncIterator[StreamEvent]` carries both text deltas (the streamed
assistant reply) and tool lifecycle events (so the UI can render "Searching
scholarships…" chips while the model is calling `web_search` / the
custom `search_perplexity` / `analyze_career_path` tools).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class TextDelta:
    text: str
    kind: Literal["text"] = "text"


@dataclass(frozen=True, slots=True)
class ToolStart:
    tool_call_id: str
    name: str
    source: Literal["function", "builtin"]
    kind: Literal["tool_start"] = "tool_start"


@dataclass(frozen=True, slots=True)
class ToolEnd:
    tool_call_id: str
    name: str
    source: Literal["function", "builtin"]
    outcome: Literal["success", "failed", "denied"] = "success"
    kind: Literal["tool_end"] = "tool_end"


StreamEvent = TextDelta | ToolStart | ToolEnd
