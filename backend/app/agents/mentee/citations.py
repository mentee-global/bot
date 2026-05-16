"""Citation regexes, URL canonicalization, and post-processing.

Owns the regex constants and helpers that the mentee agent uses to
clean model-emitted text, write the per-run citation ledger
(`deps.citations`), and enforce the allowlist on URLs that survive
into the persisted body.

Leaf module: depends only on stdlib and `app.agents.mentee.deps` for
the `Citation` / `CitationSource` / `MenteeDeps` types. Streaming,
harvest, trailer, and agent orchestration all import from here — not
the other way around.
"""

from __future__ import annotations

import re
from collections.abc import Collection

from app.agents.mentee.deps import Citation, CitationSource, MenteeDeps

_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\)\s]+)\)")
# A "slug" the model echoes right before a real URL it pulled from a tool
# result. Example: `plm/ (https://careers.cern/jobs/full-stack-software-engineer-plm/)`.
# The model writes the path tail twice — once as bare text, once as a real
# clickable URL. The bare text is never a working link on its own and reads
# like broken markdown. We detect "slug (URL)" pairs where the URL's path
# *ends with* the slug and drop the redundant slug. Anchored on whitespace
# on the left so we don't eat the trailing slash of a real preceding URL.
_REDUNDANT_SLUG_BEFORE_URL_RE = re.compile(
    r"(?<=[\s.;:!?])"                       # left boundary: ws or punct
    r"([a-z0-9][a-z0-9_/.-]*?/)"            # the slug, ending with /
    r"\s+\((https?://[^\s)]+)\)",           # then " (URL)"
    re.IGNORECASE,
)
# Bare "cite" left behind when the URL it trailed was already stripped (out
# of allowlist, PUA pair removed, etc.). Required shape: a sentence-ending
# punctuation mark, whitespace, "cite", optional trailing ".", then end of
# line or string. The punctuation lookbehind + EOL constraint protects
# legitimate prose ("I'd like to cite a source.") because in that case
# "cite" is followed by " a source", not whitespace-to-EOL.
_BARE_CITE_RE = re.compile(
    r"(?<=[.!?])[ \t]+cite\.?(?=\s*$)",
    re.MULTILINE,
)
# Bare-domain shorthand the model writes when it wants to "credit" a source
# but doesn't write a real URL — `(sem.admin.ch)`, `(jobs.ch)`, `(admin.ch)`.
# These aren't clickable, render as dead parens for the user, and add no
# information beyond the SOURCES bar. Strip them entirely. Allowed shape:
# `(host.tld)` or `(host.tld.tld)` — TLD must be 2+ alpha chars, host is
# alnum + dashes/dots, no path, no spaces, no protocol. Lookahead avoids
# eating parens that have additional content (`(jobs.ch/path)` is left
# alone — handled by other regexes).
_BARE_DOMAIN_CITATION_RE = re.compile(
    r" ?\(\s*"
    r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+"  # one or more host segments
    r"[a-z]{2,}"                                # final TLD
    r"\s*\)",
    re.IGNORECASE,
)
# OpenAI's Responses API wraps citation markers in Unicode Private-Use-Area
# codepoints — `citeturn0search0` style. Pydantic-ai
# passes these through verbatim regardless of `openai_include_raw_annotations`
# (confirmed against pydantic-ai 1.84.1 source), so we must strip them
# server-side or `citeturn0search0` leaks into persisted bodies once the
# PUA wrappers get dropped downstream. The first regex catches well-formed
# `\uE2NN…\uE2NN` pairs and removes the whole span including inner text;
# the second mops up isolated PUA codepoints that survive when a stream
# chunk boundary splits the wrapping pair across emits.
_PUA_CITATION_RE = re.compile(r"[-][^-]*[-]")
_STRAY_PUA_RE = re.compile(r"[-]")


# URL extraction. Match anything up to whitespace and the few characters
# that almost never appear inside a URL. Parens and brackets are *allowed*
# inside (some URLs really contain them, e.g. jobright.ai/...(remote,-latam)),
# so trailing-punctuation stripping does balanced-bracket cleanup instead.
_URL_RE = re.compile(r'https?://[^\s<>"]+')
# Permissive probe used only by the streaming stripper's mid-URL back-off:
# matches a bare scheme + zero or more body chars, so we can detect a cut
# that landed right after `://` (where `_URL_RE` would miss).
_URL_PROBE_RE = re.compile(r'https?://[^\s<>"]*')
_URL_TRAIL_PUNCT = ".,;:!?"


def _strip_url_trailing_punct(url: str) -> tuple[str, str]:
    """Split a regex-matched URL into (clean_url, trailing_punct).

    Punctuation comes in two flavors:
      - sentence-end chars (".,;:!?") — always stripped from the tail
      - closing brackets (")", "]") — stripped only when unbalanced (i.e.
        more closers than openers in the URL), so genuine in-URL parens
        like `/foo(bar)/` survive while trailing markdown brackets don't.
    """
    trail = ""
    while url:
        last = url[-1]
        if last in _URL_TRAIL_PUNCT:
            trail = last + trail
            url = url[:-1]
            continue
        if last == ")" and url.count("(") < url.count(")"):
            trail = last + trail
            url = url[:-1]
            continue
        if last == "]" and url.count("[") < url.count("]"):
            trail = last + trail
            url = url[:-1]
            continue
        break
    return url, trail


# Extensions that signal "this is a downloadable asset, not a page a user
# would click from a chat reply" — search tools sometimes return marketing
# PDFs or CDN attachments that we don't want surfaced as sources.
_NON_USER_FACING_EXTS = (
    ".pdf",
    ".docx",
    ".doc",
    ".xlsx",
    ".xls",
    ".csv",
    ".zip",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".mp4",
    ".mov",
)
def _is_user_facing_url(url: str) -> bool:
    """Return False for asset URLs (PDFs, images, archives) that no one
    would want to click from a chat-bot reply, even if a search tool
    returned them as a source."""
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return False
    # `?query` and `#fragment` shouldn't fool the extension match.
    bare = url.split("?", 1)[0].split("#", 1)[0].lower()
    return not bare.endswith(_NON_USER_FACING_EXTS)


# Query-param prefixes that don't change page identity. Stripped on the
# visible URL (so the user clicks a clean link) AND treated as noise for
# the dedup key.
_NOISE_QUERY_PARAMS = ("hl=", "utm_", "utm-", "ref=", "ref_")
# Path prefixes WebSearch surfaces as language variants of one canonical
# page. Used only to compute the dedup key — the visible URL keeps its
# locale so the user clicks the right translation.
_LOCALE_PATH_PREFIXES = ("/en/", "/de/", "/es/", "/fr/", "/it/", "/pt/", "/ar/")


def _canonical_url(url: str) -> tuple[str, str]:
    """Return ``(visible_url, canonical_key)``.

    WebSearch surfaces every accessible URL on a domain — language
    variants (`/en/`, `/de/`, ...), `/print` versions, glossary entries,
    `?hl=en-US` query duplicates. One real page can produce 20+ URLs.
    Canonicalizing collapses those into a single citation while keeping
    the user-facing URL pointed at the locale variant we'd prefer to
    show.

    - ``visible_url``: trailing slash stripped, `/print` suffix dropped,
      noise query params removed. Stored on `Citation.url` and rendered.
    - ``canonical_key``: additionally collapses language-prefix path
      variants so `/en/foo`, `/de/foo`, `/es/foo` share a dedup key.
      Stored as the dict key in `deps.citations` so a second writer for
      a different locale variant merges into the first.

    Only `http(s)` URLs reach here — the asset filter runs upstream.
    """
    if not isinstance(url, str):
        return url, url
    visible = url.strip()

    # Split scheme + rest so the path manipulation can't accidentally
    # touch the host.
    scheme_sep = visible.find("://")
    if scheme_sep == -1:
        return visible, visible
    scheme = visible[: scheme_sep + 3]
    rest = visible[scheme_sep + 3 :]

    # Lop off ?query and #fragment, rebuild ?query without the noise keys.
    rest_main, frag = (rest.split("#", 1) + [""])[:2]
    path_q = rest_main.split("?", 1)
    path = path_q[0]
    query = path_q[1] if len(path_q) == 2 else ""
    if query:
        kept = [
            kv
            for kv in query.split("&")
            if kv and not kv.lower().startswith(_NOISE_QUERY_PARAMS)
        ]
        query = "&".join(kept)

    # Drop a trailing /print or /print/ segment — variant of the same page.
    lowered = path.lower()
    if lowered.endswith("/print"):
        path = path[: -len("/print")]
    elif lowered.endswith("/print/"):
        path = path[: -len("/print/")]
    path = path.rstrip("/")

    rebuilt = scheme + (
        path
        + (f"?{query}" if query else "")
        + (f"#{frag}" if frag else "")
    )
    visible_url = rebuilt or visible.rstrip("/")

    # Canonical key: same shape, but with language-prefix collapsed to a
    # sentinel so /en/foo and /de/foo dedupe. Only collapse when the
    # path actually starts with one of the known locale prefixes; never
    # touch hosts whose path happens to contain `/en/` later on.
    host_and_after = rebuilt[scheme_sep + 3 :]
    if "/" in host_and_after:
        first_slash = host_and_after.index("/")
        host_part = rebuilt[: scheme_sep + 3 + first_slash]
        path_part = rebuilt[scheme_sep + 3 + first_slash :]
    else:
        host_part = rebuilt
        path_part = ""
    canonical_path = path_part
    for prefix in _LOCALE_PATH_PREFIXES:
        if canonical_path.lower().startswith(prefix):
            canonical_path = "/__/" + canonical_path[len(prefix) :]
            break
    canonical_key = (host_part + canonical_path).rstrip("/")

    return visible_url, canonical_key


def _add_url_to_allowlist(
    deps: MenteeDeps,
    url: str,
    *,
    source: CitationSource,
    title: str | None = None,
    snippet: str | None = None,
) -> None:
    """Insert `url` into the per-run citation ledger if it's a user-facing
    page, recording optional `title` + `snippet`.

    Stored under a canonical key so locale / print / tracking-param
    variants of the same page collapse into one citation. First writer
    sets `source`. A later writer can upgrade an empty title (e.g.
    WebSearch returns a title for a URL Perplexity surfaced first) and
    can swap the visible URL when its locale variant matches
    `deps.ui_locale` better than what's stored.
    """
    if not _is_user_facing_url(url):
        return
    visible_url, canonical_key = _canonical_url(url)
    clean_title = title.strip() if title else None
    clean_snippet = snippet.strip() if snippet else None
    existing = deps.citations.get(canonical_key)
    if existing is not None:
        if clean_title and not existing.title:
            existing.title = clean_title
        if clean_snippet and not existing.snippet:
            existing.snippet = clean_snippet
        # If a later variant matches the user's UI locale better than
        # what we stored first, prefer the locale variant for display.
        if deps.ui_locale and existing.url != visible_url:
            locale_marker = f"/{deps.ui_locale.split('-', 1)[0].lower()}/"
            if locale_marker in visible_url.lower() and locale_marker not in existing.url.lower():
                existing.url = visible_url
        return
    deps.citations[canonical_key] = Citation(
        url=visible_url,
        source=source,
        title=clean_title,
        snippet=clean_snippet,
    )


def _split_concatenated_urls(text: str) -> str:
    """Insert a space when one URL runs straight into another.

    The model occasionally writes two URLs back to back with no separator
    (`https://platzi.com/https://platzi.com/cursos` — visible in the wild).
    The browser then treats the whole thing as one URL and 404s. Split on
    any `https?://` that appears mid-URL — false positives are limited to
    redirect-style links that embed another URL in their query string,
    which are rare.
    """
    # Lookahead matches *only* when another https:// follows immediately
    # without whitespace; the non-greedy body keeps each URL minimal.
    return re.sub(r"(https?://[^\s]*?)(?=https?://)", r"\1 ", text)


def _drop_redundant_slug_before_url(text: str) -> str:
    """Strip the bare path-slug the model echoes right before a real URL.

    The model occasionally renders citations as `slug/ (https://host/.../slug/)`
    — the slug is the last path segment of the URL repeated as plain text.
    Looks like broken markdown to the user. We detect that exact shape and
    keep just the parenthesized URL.
    """

    def repl(match: re.Match[str]) -> str:
        slug = match.group(1).rstrip("/").lower()
        url = match.group(2)
        # Two safety rails so we don't eat legitimate prose:
        #  1. Slug must be at least 3 chars — kills 1-2-char prose like
        #     `a/`, `y/`. 3 is the minimum real slug length we see
        #     (`plm`, `api`, etc.).
        #  2. Slug must be a *suffix* of the URL path. Models write the
        #     trailing portion of the path verbatim — for the actual cases
        #     we see (`plm/`, `sd-gss-2026-96-ld/`, `detail/fd4b6a98-…/`)
        #     `path.endswith(slug)` is the cleanest match.
        if len(slug) < 3:
            return match.group(0)
        from urllib.parse import urlparse

        try:
            path = urlparse(url).path.rstrip("/").lower()
        except Exception:  # noqa: BLE001 — bad URL stays untouched
            return match.group(0)
        if path.endswith(slug):
            return f"({url})"
        return match.group(0)

    return _REDUNDANT_SLUG_BEFORE_URL_RE.sub(repl, text)


def _strip_citations(text: str) -> str:
    r"""Pre-allowlist cleanup of model-emitted text.

    Five passes, ordered so each can rely on what the earlier passes
    removed:

    1. **PUA citation wrappers** — `\uE2NN…\uE2NN`-wrapped tokens injected
       by OpenAI's Responses API around every cited URL, regardless of
       the `openai_include_raw_annotations` flag. Stripping the wrapped
       span (including inner `citeturn0search0` text) here means the
       persisted body is clean before `_BARE_CITE_RE` runs.
    2. **Stray PUA codepoints** — single PUA chars that escape (1) when
       a stream chunk boundary splits the wrapper pair.
    3. **Path-slug-before-URL** — model echoes the URL's last segment as
       plain text right before the real URL (`plm/ (https://…/plm/)`).
    4. **Bare `cite` tokens** — what's left of a citation when the PUA
       wrapper has been stripped but a trailing `cite` survives.
    5. **Bare-domain shorthand** in parens (`(sem.admin.ch)`). Not a URL,
       not clickable — strip and let the SOURCES bar carry the link.

    Allowlist enforcement happens after, in `_filter_off_allowlist_urls`.
    """
    text = _PUA_CITATION_RE.sub("", text)
    text = _STRAY_PUA_RE.sub("", text)
    text = _drop_redundant_slug_before_url(text)
    text = _split_concatenated_urls(text)
    text = _BARE_CITE_RE.sub("", text)
    text = _BARE_DOMAIN_CITATION_RE.sub("", text)
    return text


def _filter_off_allowlist_urls(
    text: str,
    cited: Collection[str],
    *,
    on_strip: object | None = None,
) -> str:
    """Strip URLs the model wrote that aren't in the per-run allowlist.

    Handles two URL forms uniformly:

    - **Markdown links** `[text](url)`: if the URL is allowed, keep the
      whole link. If not, keep just the link text and drop the URL +
      surrounding `()` — readers still see a descriptive label, just
      without a (potentially fabricated) target.
    - **Bare URLs** `https://…`: if the URL is allowed, keep it. If not,
      drop it but preserve any trailing sentence punctuation so the
      surrounding prose still reads naturally.

    `cited` holds canonical citation keys (locale-prefix collapsed,
    print/utm/hl stripped). We run each URL the model wrote through
    `_canonical_url` before checking membership so the model's
    locale-specific URL (`/en/...`) still matches a citation indexed by
    its canonical key. `on_strip` is an optional telemetry callable
    invoked once per stripped URL.
    """
    def _is_allowed(raw_url: str) -> bool:
        clean, _ = _strip_url_trailing_punct(raw_url)
        _, canonical_key = _canonical_url(clean)
        return canonical_key in cited

    def _notify_strip(raw_url: str) -> None:
        if callable(on_strip):
            try:
                clean, _ = _strip_url_trailing_punct(raw_url)
                on_strip(clean)  # type: ignore[misc]
            except Exception:  # noqa: BLE001 — telemetry must not break output
                pass

    # 1. Markdown links first so the bare-URL pass below doesn't pick up
    # the URL portion of a link that we're about to keep wholesale.
    def md_repl(match: re.Match[str]) -> str:
        link_text = match.group(1)
        url = match.group(2)
        if _is_allowed(url):
            return f"[{link_text}]({url})"
        _notify_strip(url)
        return link_text

    text = _MD_LINK_RE.sub(md_repl, text)

    # 2. Bare URLs the model wrote without markdown wrapping.
    def bare_repl(match: re.Match[str]) -> str:
        raw = match.group(0)
        if _is_allowed(raw):
            return raw
        _, trail = _strip_url_trailing_punct(raw)
        _notify_strip(raw)
        return trail

    return _URL_RE.sub(bare_repl, text)
