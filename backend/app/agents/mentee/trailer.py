"""Sources trailer + UsageLimitExceeded recovery copy.

The sources trailer is an HTML comment appended to every persisted
assistant body — the frontend strips it before rendering and uses its
JSON payload to populate the SOURCES bar pills. Trailer rendering
intersects the per-run citation ledger (`deps.citations`) with the URLs
the model actually wrote inline so the SOURCES bar mirrors what the
user reads, not the full tool-return surface.

Localized recovery copy is the short suffix appended when streaming
hits the per-run `UsageLimitExceeded` cap. Language is picked from
`MenteeDeps.ui_locale` with English fallback.

Depends on `citations` (for URL extraction + canonicalization) and
`deps` (for the `Citation` type). Imported by `agent.py`.
"""

from __future__ import annotations

import json

from app.agents.mentee.citations import (
    _URL_RE,
    _canonical_url,
    _strip_url_trailing_punct,
)
from app.agents.mentee.deps import Citation

# Trailer marker — must match what the frontend strips and parses. Kept
# deliberately specific so we don't accidentally collide with model output.
_SOURCES_TRAILER_PREFIX = "<!-- mentee-sources: "
_SOURCES_TRAILER_SUFFIX = " -->"


# Localized recovery deltas for `UsageLimitExceeded` mid-stream. Picked at
# stream-cap time and appended to whatever partial text the user already
# sees, so they understand the reply ended early rather than thinking the
# bot stopped on its own. Keep these short — they're meant to be additive,
# not replacement copy. Language picked from `ui_locale` (see
# MenteeDeps.ui_locale); falls back to English when the locale is unset
# or unknown so the message is at least intelligible.
_USAGE_LIMIT_RECOVERY = {
    "en": (
        "\n\n— I had to cut the response short before finishing. "
        "Want me to pick it up from where it stopped?"
    ),
    "es": (
        "\n\n— tuve que cortar la respuesta antes de terminar. "
        "¿Quieres que retome desde donde se cortó?"
    ),
    "pt": (
        "\n\n— precisei cortar a resposta antes de terminar. "
        "Quer que eu continue de onde parei?"
    ),
    "ar": (
        "\n\n— اضطررت إلى قطع الإجابة قبل إكمالها. "
        "هل تريد أن أكمل من حيث توقفت؟"
    ),
}


def _usage_limit_recovery_text(ui_locale: str | None) -> str:
    """Pick the recovery delta for the active locale; default to English."""
    if ui_locale:
        # Match on the bare language code so "en-US"/"es-CO" still hit.
        code = ui_locale.split("-", 1)[0].lower()
        if code in _USAGE_LIMIT_RECOVERY:
            return _USAGE_LIMIT_RECOVERY[code]
    return _USAGE_LIMIT_RECOVERY["en"]


def _format_sources_trailer(
    citations: dict[str, Citation],
    body_text: str,
) -> str:
    """Render the per-message URL sidecar as an HTML comment, restricted
    to URLs the model actually wrote inline in ``body_text``.

    Pre-Stage-4 the trailer dumped every URL a tool returned, which led
    to the 24-pill SOURCES bar problem (WebSearch surfaces every
    accessible URL on a domain). Intersecting with the body means the
    sidecar mirrors what the user reads: if the model cited two URLs
    inline, two entries appear.

    Each URL extracted from the body is canonicalized via
    `_canonical_url` so locale / print / utm variants match the
    canonical key in `deps.citations`. The emitted JSON key is the
    citation's **visible** URL.

    Wire shape (post Option G):

        {visible_url: {"title": str, "source": "openai_web_search"
                                              | "perplexity"
                                              | "model_training"}}

    The frontend uses ``source`` to render tool-verified URLs as
    SOURCES-bar pills and inline links, and to render
    ``model_training`` URLs as inline-only with a muted style + tooltip
    so the mentee can tell which links the bot grounded against this
    turn versus which came from the model's training knowledge.
    """
    if not citations:
        return ""

    cited_keys_in_body: set[str] = set()
    for raw in _URL_RE.findall(body_text):
        clean, _ = _strip_url_trailing_punct(raw)
        _, canonical_key = _canonical_url(clean)
        cited_keys_in_body.add(canonical_key)

    payload: dict[str, dict[str, str]] = {}
    for canonical_key, citation in citations.items():
        if canonical_key not in cited_keys_in_body:
            continue
        entry: dict[str, str] = {"source": citation.source}
        title = (citation.title or "").strip()
        if title:
            entry["title"] = title
        payload[citation.url] = entry
    if not payload:
        return ""
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"\n\n{_SOURCES_TRAILER_PREFIX}{body}{_SOURCES_TRAILER_SUFFIX}"
