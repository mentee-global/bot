"""URL harvesting from pydantic-ai message history.

After a turn completes (or as it streams), OpenAI's built-in web_search
tool surfaces its source URLs in two places on the message tree:

- `BuiltinToolReturnPart.content["sources"]` — populated when
  `openai_include_web_search_sources=True`. URL-only entries, no title.
- `TextPart.provider_details["annotations"]` — populated when
  `openai_include_raw_annotations=True`. Carries per-URL `title` strings
  that we want for the SOURCES bar.

The orchestration calls this harvester from both the non-streaming and
streaming paths so the citation ledger (`deps.citations`) is populated
before the allowlist filter or trailer formatter run. Writes go through
`_add_url_to_allowlist`, which canonicalizes the URL and merges
duplicates first-writer-wins (with title upgrades allowed).
"""

from __future__ import annotations

from pydantic_ai.messages import (
    BuiltinToolReturnPart,
    ModelMessage,
    ModelResponse,
    TextPart,
)

from app.agents.mentee.citations import _add_url_to_allowlist
from app.agents.mentee.deps import MenteeDeps


def _harvest_urls_from_messages(
    messages: list[ModelMessage], deps: MenteeDeps
) -> None:
    """Populate `deps.citations` (and kick off liveness checks) from
    web_search sources and TextPart annotations.

    OpenAI's built-in web_search returns its source URLs on the
    `BuiltinToolReturnPart.content["sources"]` list (when
    `openai_include_web_search_sources=True`) and as `url_citation`
    annotations on each TextPart's `provider_details["annotations"]` (when
    `openai_include_raw_annotations=True`). We consult both because the
    streaming and non-streaming paths both surface them.
    """
    for msg in messages:
        if not isinstance(msg, ModelResponse):
            continue
        for part in msg.parts:
            if isinstance(part, BuiltinToolReturnPart):
                content = part.content
                if isinstance(content, dict):
                    for src in content.get("sources") or []:
                        if isinstance(src, dict):
                            src_title = src.get("title")
                            _add_url_to_allowlist(
                                deps,
                                src.get("url") or "",
                                source="openai_web_search",
                                title=src_title if isinstance(src_title, str) else None,
                            )
            elif isinstance(part, TextPart):
                details = part.provider_details or {}
                for ann in details.get("annotations") or []:
                    if (
                        isinstance(ann, dict)
                        and ann.get("type") == "url_citation"
                    ):
                        title = ann.get("title")
                        _add_url_to_allowlist(
                            deps,
                            ann.get("url") or "",
                            source="openai_web_search",
                            title=title if isinstance(title, str) else None,
                        )
