"""Evaluators for the Mentee agent eval suite.

Three deterministic evaluators run on every case (free, fast). Two
LLM-as-judge evaluators run only on cases tagged
`metadata.judges_apply=True`. The judges use `pydantic-ai` so their
output is a structured `{score, reasoning}` instead of free text.

Why the deterministic checks reuse the agent's own regex constants
(`_BARE_DOMAIN_CITATION_RE`, `_URL_RE`): they are the canonical
definition of "bad shape" inside the post-processor. If the agent's
own pipeline doesn't think the body is dirty, neither should the
grader — and vice versa.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from app.agents.mentee.citations import (
    _BARE_DOMAIN_CITATION_RE,
    _URL_RE,
    _canonical_url,
    _strip_url_trailing_punct,
)
from app.core.config import settings as default_settings

from .dataset import MenteeInput, MenteeMetadata, MenteeOutput

# --- Deterministic evaluators ----------------------------------------


# Any codepoint in the Unicode Private-Use Area. OpenAI's Responses API
# wraps citation markers in `..` characters; if any
# survive into the persisted body, the cleanup pipeline missed them.
_PUA_RE = re.compile(r"[-]")

# ASCII residue left behind when the PUA wrapper is stripped but the
# inside text isn't. The literal pattern `cite` followed by
# `turn<N>search<N>` is OpenAI-specific and never appears in
# legitimate mentee-domain prose.
_CITETURN_RE = re.compile(r"cite(?:turn\d+search\d+)+", re.IGNORECASE)


@dataclass
class NoMarkerLeak(Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]):
    """Body free of PUA citation wrappers, `citeturn` ASCII residue, and
    bare-domain shorthand like `(host.tld)`.

    Returns 1.0 on clean, 0.0 on any leak. We don't grade partial because
    a single leak is a regression we want to surface unambiguously.
    """

    def evaluate(
        self, ctx: EvaluatorContext[MenteeInput, MenteeOutput, MenteeMetadata]
    ) -> dict[str, float]:
        body = ctx.output.body
        return {
            "no_pua_chars": 0.0 if _PUA_RE.search(body) else 1.0,
            "no_citeturn_ascii": 0.0 if _CITETURN_RE.search(body) else 1.0,
            "no_bare_domain_shorthand": (
                0.0 if _BARE_DOMAIN_CITATION_RE.search(body) else 1.0
            ),
        }


@dataclass
class URLsInAllowlist(Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]):
    """Every `https://` URL the model wrote in the body should resolve to
    a citation key (`deps.citations`). A model that writes an off-
    allowlist URL is either hallucinating or grounding on stale priors.

    `deps.citations` is keyed by **canonical** URL (locale-prefix
    collapsed, print / utm / hl stripped — see `_canonical_url` in
    agent.py). Body URLs are locale-specific. We canonicalize the body
    URL before the membership check so a model writing
    `https://x.com/en/foo` still matches a citation indexed under the
    canonical `https://x.com/__/foo` key.

    Score = ratio of in-allowlist URLs / total URLs. Returns 1.0 on
    cases with zero URLs (vacuously true — chitchat / refusal turns).
    """

    def evaluate(
        self, ctx: EvaluatorContext[MenteeInput, MenteeOutput, MenteeMetadata]
    ) -> float:
        urls = _URL_RE.findall(ctx.output.body)
        if not urls:
            return 1.0
        allowed = set(ctx.output.citations)  # already canonical keys
        hits = 0
        for raw in urls:
            clean, _ = _strip_url_trailing_punct(raw)
            _, canonical_key = _canonical_url(clean)
            if canonical_key in allowed:
                hits += 1
        return hits / len(urls)


@dataclass
class SourcesBarRendersSomething(
    Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]
):
    """When the case expects sources (search-shaped intent) and a tool
    fired, at least one citation should carry a non-empty title.

    Skipped (returns 1.0) when the case's metadata says
    `expects_sources=False` — chitchat / refusal turns are not expected
    to render a SOURCES bar.
    """

    def evaluate(
        self, ctx: EvaluatorContext[MenteeInput, MenteeOutput, MenteeMetadata]
    ) -> float:
        meta = ctx.metadata
        if meta is None or not meta.expects_sources:
            return 1.0
        citations = ctx.output.citations
        if not citations:
            return 0.0
        has_title = any(
            (entry.get("title") or "").strip() for entry in citations.values()
        )
        return 1.0 if has_title else 0.0


# Strip the trailing `<!-- mentee-sources: ... -->` HTML comment the
# trailer formatter appends, so the length check measures only what the
# mentee sees in the chat surface.
_TRAILER_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
# Line starting with `### ` (Markdown H3) — the model's default heavy
# structure marker that we want to absent from short conversational
# turns.
_H3_HEADING_RE = re.compile(r"(?m)^###\s")


@dataclass
class ConversationalShapeAppropriate(
    Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]
):
    """Turn shape matches the conversational register the case expects.

    Gated by `metadata.expects_short_prose`. The case represents a
    chat turn where heavy markdown is inappropriate — single
    clarifying question, refusal, acknowledgement, emotional reply,
    repeat acknowledgement, vague-seed reply that needs one filter.

    A reply passes when it contains NO `###` heading anywhere AND
    its visible body (trailer HTML comment stripped) is under the
    prose cap. Otherwise the reply is "report-shaped" — fails the
    `feels-like-chat` quality bar even if the underlying content is
    correct.

    Returns 1.0 (vacuously) when `expects_short_prose=False` so this
    evaluator never grades search-shaped turns harshly for using
    structure where structure is earned.
    """

    max_chars: int = 600

    def evaluate(
        self, ctx: EvaluatorContext[MenteeInput, MenteeOutput, MenteeMetadata]
    ) -> float:
        meta = ctx.metadata
        if meta is None or not meta.expects_short_prose:
            return 1.0
        body = ctx.output.body
        if _H3_HEADING_RE.search(body):
            return 0.0
        visible = _TRAILER_COMMENT_RE.sub("", body).strip()
        if len(visible) > self.max_chars:
            return 0.0
        return 1.0


# --- LLM-as-judge evaluators -----------------------------------------


class _JudgeVerdict(BaseModel):
    """Structured output for LLM-as-judge calls."""

    score: int  # 1..5
    reasoning: str


def _make_judge(
    system_prompt: str, model_name: str = "gpt-5.4-mini"
) -> Agent[None, _JudgeVerdict]:
    """Build a judge agent.

    We construct the `OpenAIProvider` explicitly with the project's
    configured API key — pydantic-ai's bare `"openai:..."` string spec
    reads from `OPENAI_API_KEY` env, but this project loads it via
    `pydantic-settings` from `backend/.env`, which doesn't export to
    `os.environ`. Without this we silently fall back to no-auth and
    every judge errors.
    """
    if default_settings.openai_api_key is None:
        raise RuntimeError(
            "OPENAI_API_KEY is unset; cannot run LLM-as-judge evaluators."
        )
    provider = OpenAIProvider(
        openai_client=AsyncOpenAI(
            api_key=default_settings.openai_api_key.get_secret_value(),
        ),
    )
    return Agent(
        model=OpenAIResponsesModel(model_name, provider=provider),
        output_type=_JudgeVerdict,
        instructions=system_prompt,
        retries=2,
    )


_ACTIONABILITY_RUBRIC = """You grade a single response from a mentorship bot. The mentee asked for HELP TAKING AN ACTION (search, find, list, compare, look up).

Score the response on actionability, 1–5:
- 5: bot fully acted this turn (specific items with URLs, concrete next steps the mentee can do today).
- 4: bot mostly acted, with one minor gap.
- 3: bot acted partially and asked one focused follow-up question that was actually necessary.
- 2: bot mostly punted ("Si quieres, en el siguiente mensaje…", "Pásame tu CV", "Could you tell me more about…") when it should have produced results.
- 1: bot pushed all work to a future turn.

Reasoning must cite the specific phrase that drove your score (good or bad). Output JSON via the schema you've been given."""

_GROUNDING_RUBRIC = """You grade whether a response's factual claims are grounded in cited URLs.

You see the response text and the list of URLs that the response actually wrote inline. Treat any non-trivial claim (a number, a deadline, a salary, a program name, a specific company, a visa rule) as a "factual claim".

Score, 1–5:
- 5: every factual claim is tied to one of the cited URLs (the URL is written adjacent to the claim, the same paragraph, or in a clearly attributable sentence).
- 4: most claims grounded, one or two stray.
- 3: half grounded, half asserted on priors.
- 2: most claims ungrounded, but the response does include some URLs.
- 1: no cited URLs at all when at least three factual claims appear.

Cosmetic claims (encouragement, restating the mentee's question, general advice) don't count. Output JSON via the schema."""


@dataclass
class Actionability(Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]):
    """LLM-as-judge: did the bot act this turn or push to the next?"""

    model: str = "gpt-5.4-mini"

    async def evaluate(
        self, ctx: EvaluatorContext[MenteeInput, MenteeOutput, MenteeMetadata]
    ) -> float | None:
        meta = ctx.metadata
        if meta is None or not meta.judges_apply:
            return None
        judge = _make_judge(_ACTIONABILITY_RUBRIC, model_name=self.model)
        prompt = (
            f"User message: {ctx.inputs.message}\n\n"
            f"Bot response:\n{ctx.output.body}"
        )
        result = await judge.run(prompt)
        verdict = result.output
        # Normalize 1..5 → 0..1 so reports aggregate cleanly with the
        # deterministic evaluators.
        return _score_to_unit(verdict.score)


@dataclass
class CitationGrounding(Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]):
    """LLM-as-judge: are factual claims tied to cited URLs?"""

    model: str = "gpt-5.4-mini"

    async def evaluate(
        self, ctx: EvaluatorContext[MenteeInput, MenteeOutput, MenteeMetadata]
    ) -> float | None:
        meta = ctx.metadata
        if meta is None or not meta.judges_apply:
            return None
        urls_in_body = sorted(set(_URL_RE.findall(ctx.output.body)))
        judge = _make_judge(_GROUNDING_RUBRIC, model_name=self.model)
        prompt = (
            f"Cited URLs (written inline): {urls_in_body if urls_in_body else '[]'}\n\n"
            f"Bot response:\n{ctx.output.body}"
        )
        result = await judge.run(prompt)
        verdict = result.output
        return _score_to_unit(verdict.score)


# --- Helpers ---------------------------------------------------------


def _score_to_unit(score: int) -> float:
    """Project a 1..5 judge score into a 0..1 evaluator output so the
    aggregate report mixes cleanly with deterministic evaluators.
    """
    return max(0.0, min(1.0, (score - 1) / 4.0))


def default_evaluators() -> list[Evaluator[MenteeInput, MenteeOutput, MenteeMetadata]]:
    """The dataset-level evaluator list used by every baseline run."""
    return [
        NoMarkerLeak(),
        URLsInAllowlist(),
        SourcesBarRendersSomething(),
        ConversationalShapeAppropriate(),
        Actionability(),
        CitationGrounding(),
    ]


__all__ = (
    "Actionability",
    "CitationGrounding",
    "ConversationalShapeAppropriate",
    "NoMarkerLeak",
    "SourcesBarRendersSomething",
    "URLsInAllowlist",
    "default_evaluators",
)


# Silence the unused import warning for typing-only re-export.
_TYPING_ANCHOR: Any = (MenteeInput, MenteeMetadata, MenteeOutput)
