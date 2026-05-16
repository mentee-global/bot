"""Streaming-safe citation stripper for the mentee agent.

`MenteeAgent.stream_reply` emits text deltas as the model produces
them. We can't run the full citation post-processing on every chunk —
a citation marker, a URL, or an unclosed markdown link can straddle a
chunk boundary, and a delta-local strip would corrupt them. Instead
this module buffers a fixed tail (`_SAFE_TAIL` chars) so any reasonable
URL or marker is seen whole at validation time, then runs the same
`_strip_citations` + `_filter_off_allowlist_urls` pipeline on the
emitable prefix.

The five-layer back-off in `_CitationStripper.feed` handles the
non-obvious cases: mid-word cuts, sentence-end punctuation, path-slug
echoes before a URL, unclosed brackets/parens, and mid-URL emit
boundaries (including the case where the cut lands inside the `https:/`
scheme prefix).

Depends on `citations` (for the URL probe regex and the post-processors)
and `deps` is reached transitively. Imported by `agent.py` only.
"""

from __future__ import annotations

from app.agents.mentee.citations import (
    _URL_PROBE_RE,
    _filter_off_allowlist_urls,
    _strip_citations,
)
from app.agents.mentee.deps import Citation


def _last_balanced_pos(buf: str, end: int) -> int:
    """Return the largest position p <= `end` where every `[` and `(`
    in `buf[0:p]` is matched by a corresponding `]` / `)` also in
    `buf[0:p]`. Used by the streaming stripper to avoid cutting in the
    middle of an unclosed markdown citation like `[host](url-still-streaming…`.

    Counts unmatched closers as balanced (extra `)` is fine — only
    unmatched openers force a back-off). Worst case O(end).
    """
    sq = pr = 0
    last = 0
    for i in range(end):
        ch = buf[i]
        if ch == "[":
            sq += 1
        elif ch == "]":
            if sq > 0:
                sq -= 1
        elif ch == "(":
            pr += 1
        elif ch == ")":
            if pr > 0:
                pr -= 1
        if sq == 0 and pr == 0:
            last = i + 1
    return last


class _CitationStripper:
    """Streaming-safe stripper that buffers a tail so markers split across
    deltas still get matched.

    Also enforces the per-run URL allowlist via the `citations` dict
    (canonical-key → Citation): when a URL appears in the emit chunk it
    is kept iff present in the dict (and rewritten to the citation's
    canonical visible URL — drops `?utm_source=openai`, etc); otherwise
    it is dropped. The buffer's `_SAFE_TAIL` (256 chars) is generous
    enough to contain any reasonable URL, so a URL straddling two deltas
    is always seen whole at validation time.

    We import `Citation` from `deps.py` for the type annotation only;
    the layering is fine because `deps.py` is the canonical data-shape
    module and is upstream of every implementation file.
    """

    _SAFE_TAIL = 256

    def __init__(
        self,
        citations: dict[str, Citation] | None = None,
        on_strip_url: object | None = None,
    ) -> None:
        self._buf = ""
        self._citations: dict[str, Citation] = (
            citations if citations is not None else {}
        )
        self._on_strip_url = on_strip_url

    def _post_process(self, text: str) -> str:
        text = _strip_citations(text)
        text = _filter_off_allowlist_urls(
            text,
            self._citations,
            on_strip=self._on_strip_url,
        )
        return text

    def feed(self, delta: str) -> str:
        self._buf += delta
        if len(self._buf) <= self._SAFE_TAIL:
            return ""
        # The four back-off layers can each expose state the previous
        # layers need to revisit (e.g. the balanced-parens back-off may
        # roll cut_end back to just before an unclosed `(`, which can
        # leave a path-slug like `plm/ ` orphaned in the emit half of
        # `plm/ (URL)`). Loop until the cut stops moving — bounded by
        # the buffer length, so at most O(SAFE_TAIL) iterations.
        cut_end = len(self._buf) - self._SAFE_TAIL
        for _ in range(self._SAFE_TAIL):
            prev = cut_end
            # 1. Don't cut mid-word — also includes `-`, `_`, `.` so
            # slug-like tokens (`sd-gss-2026-96-ld`, `full-stack-…`,
            # `file.py`) stay intact instead of being split between
            # an alnum chunk and a hyphen chunk.
            while cut_end > 0 and (
                self._buf[cut_end - 1].isalnum()
                or self._buf[cut_end - 1] in "-_."
            ):
                cut_end -= 1
            # 2. Don't split a sentence-end punctuation from the word
            # that follows it. `_BARE_CITE_RE` needs ".", whitespace,
            # and "cite" to sit in the same emit chunk — peeling the
            # trailing whitespace + punct keeps the "." with its
            # sentence.
            while cut_end > 0 and self._buf[cut_end - 1] in " \t\n.!?":
                cut_end -= 1
            # 3. Don't leave a trailing path-slug right at the cut.
            # `_REDUNDANT_SLUG_BEFORE_URL_RE` needs the slug + URL in
            # the same string; if emit ends with `plm/` and the tail
            # starts with ` (URL)`, the regex never fires.
            if cut_end > 0 and self._buf[cut_end - 1] == "/":
                p = cut_end - 1
                while p > 0 and (
                    self._buf[p - 1].isalnum() or self._buf[p - 1] in "-_."
                ):
                    p -= 1
                if p < cut_end - 1:
                    cut_end = p
            # 4. Don't leave an unclosed `[` or `(` in the emit region.
            # The `[text](url)` regex needs the closing `)` to match —
            # if we cut between `[text](` and `)`, the broken half
            # survives into the persisted body.
            cut_end = _last_balanced_pos(self._buf, cut_end)
            # 5. Don't cut mid-URL: detect any unfinished `https?://…`
            # prefix in the emit and back off to before its `h`. We
            # use a permissive probe (body chars are *optional*) so
            # the case where the cut lands right after `://` is also
            # caught — `_URL_RE` requires ≥1 body char and would miss
            # it. Also catch the case where the cut landed inside the
            # scheme itself (between `:` and `//`, or after `:`).
            url_probe = None
            for m in _URL_PROBE_RE.finditer(self._buf, 0, cut_end):
                url_probe = m
            if url_probe is not None and url_probe.end() == cut_end:
                cut_end = url_probe.start()
                while cut_end > 0 and self._buf[cut_end - 1] in " \t\n.!?":
                    cut_end -= 1
            else:
                for prefix in (
                    "https:/",
                    "http:/",
                    "https:",
                    "http:",
                ):
                    if self._buf[:cut_end].endswith(prefix):
                        cut_end -= len(prefix)
                        while cut_end > 0 and self._buf[cut_end - 1] in " \t\n.!?":
                            cut_end -= 1
                        break
            if cut_end == prev:
                break
        if cut_end == 0:
            return ""
        emitable = self._buf[:cut_end]
        self._buf = self._buf[cut_end:]
        return self._post_process(emitable)

    def flush(self) -> str:
        out = self._post_process(self._buf)
        self._buf = ""
        return out
