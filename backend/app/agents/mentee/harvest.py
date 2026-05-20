"""URL harvesting from pydantic-ai message history.

After a turn completes (or as it streams), OpenAI's built-in web_search
tool surfaces its source URLs in up to three places on the message tree:

- `BuiltinToolReturnPart.content["sources"]` — populated when
  `openai_include_web_search_sources=True`. URL-only entries; on
  gpt-5.4 the entries have no `title` field (older mini variants
  sometimes carried one).
- `TextPart.provider_details["annotations"]` — populated when
  `openai_include_raw_annotations=True`. Carries per-URL `title`
  strings on older models; gpt-5.4 leaves `provider_details` empty.
- `TextPart.content` itself — gpt-5.4 (per the SYSTEM_PROMPT's
  `[Title](url)` directive) writes inline markdown links with the
  human-readable title in the label. This is the only title channel
  the model populates on 5.4, so we extract it.

The orchestration calls this harvester from both the non-streaming and
streaming paths so the citation ledger (`deps.citations`) is populated
before the allowlist filter or trailer formatter run. Writes go through
`_add_url_to_allowlist`, which canonicalizes the URL and merges
duplicates first-writer-wins (with title upgrades allowed).
"""

from __future__ import annotations

import re

from pydantic_ai.messages import (
    BuiltinToolReturnPart,
    ModelMessage,
    ModelResponse,
    TextPart,
)

from app.agents.mentee.citations import _add_url_to_allowlist
from app.agents.mentee.deps import MenteeDeps

# `[label](url)` — bracketed label up to 200 chars, then a parenthesized
# http(s) URL. Stops the URL at whitespace or a closing paren so trailing
# punctuation doesn't get sucked into the match.
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^\s)]+)\)")


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
                if part.content:
                    for match in _MARKDOWN_LINK_RE.finditer(part.content):
                        label = match.group(1).strip()
                        url = match.group(2)
                        _add_url_to_allowlist(
                            deps,
                            url,
                            source="openai_web_search",
                            title=label or None,
                        )
