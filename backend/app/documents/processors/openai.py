"""OpenAI-backed document processor (plan Phase 1).

Launch scope is typed PDF / DOCX (plan decision #10a): text is pulled locally
(pypdf/python-docx — no model cost), then a concise summary/fact-sheet is
written by the model for thread memory. Scanned files with no text layer fall
back to vision OCR — wired minimally here since the pilot doesn't target scans.

Structured CV extraction (`extract`) lands in plan Phase 2.
"""

from __future__ import annotations

import json
import logging

from openai import AsyncOpenAI

from app.documents.base import (
    DocumentError,
    DocumentProcessorPort,
    ParsedDocument,
)
from app.documents.processors.local import LocalProcessor, _summarize

logger = logging.getLogger(__name__)

_SUMMARY_SYSTEM = (
    "You summarize an uploaded document so an assistant can recall it later in "
    "a conversation. Write a dense factual fact-sheet of at most 600 characters: "
    "what the document is, who/what it's about, and the key facts. No preamble."
)

_EXTRACT_SYSTEM = (
    "You extract structured data from a document and return JSON matching the "
    "provided schema. Use only information present in the document — never "
    "invent values. Leave optional fields null when the document doesn't state "
    "them. No commentary, JSON only."
)

# Cap extraction input so a huge document can't blow the call's context/cost;
# a CV/resume is comfortably within this.
_EXTRACT_CHAR_CAP = 24_000


class OpenAIDocumentProcessor(DocumentProcessorPort):
    provider_id = "openai"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        local: LocalProcessor | None = None,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._local = local or LocalProcessor()

    def supports(self, mime_type: str) -> bool:
        return self._local.supports(mime_type)

    async def parse(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> ParsedDocument:
        # Primary path: local text extraction (no model cost) for typed docs.
        parsed = await self._local.parse(
            data=data, filename=filename, mime_type=mime_type
        )
        if parsed.markdown.strip():
            summary = await self._summarize(parsed.markdown, filename=filename)
            return ParsedDocument(
                markdown=parsed.markdown,
                page_count=parsed.page_count,
                summary=summary,
                provider=self.provider_id,
            )
        # No text layer → scanned/image. Vision OCR is out of pilot scope
        # (plan decision #10a); degrade gracefully rather than crash.
        logger.info(
            "openai_processor: no text layer for %s (%s); vision OCR not enabled",
            filename,
            mime_type,
        )
        return ParsedDocument(
            markdown="",
            page_count=parsed.page_count,
            summary=(
                f"{filename}: no machine-readable text found (likely scanned). "
                "OCR is not enabled in this release."
            ),
            provider=self.provider_id,
        )

    async def extract(
        self, *, data: bytes, filename: str, mime_type: str, schema: dict
    ) -> ParsedDocument:
        """Pull text locally, then ask the model for JSON matching `schema`.

        Launch scope is typed PDF/DOCX (plan #10a): if there's no text layer
        (scanned), we don't OCR — we raise so the caller marks the document
        failed and the UI offers manual entry. The returned `structured` is the
        raw model JSON; validating it against a concrete schema (ResumeSchema)
        is the engine-agnostic service's job, keeping this port generic."""
        parsed = await self._local.parse(
            data=data, filename=filename, mime_type=mime_type
        )
        text = parsed.markdown.strip()
        if not text:
            raise DocumentError(
                f"{filename}: no machine-readable text found (likely scanned). "
                "OCR is not enabled in this release."
            )
        excerpt = text[:_EXTRACT_CHAR_CAP]
        try:
            resp = await self._client.responses.create(
                model=self._model,
                input=[
                    {"role": "system", "content": _EXTRACT_SYSTEM},
                    {"role": "user", "content": f"Filename: {filename}\n\n{excerpt}"},
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "extraction",
                        # Non-strict: a CV has many optional/nullable fields, and
                        # OpenAI strict mode requires every property in `required`
                        # + additionalProperties:false everywhere. The service
                        # validates the result against ResumeSchema regardless.
                        "strict": False,
                        "schema": schema,
                    }
                },
            )
        except Exception as exc:  # noqa: BLE001 — surface as an extraction failure
            raise DocumentError(f"extraction call failed: {exc}") from exc

        raw = (resp.output_text or "").strip()
        try:
            structured = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as exc:
            raise DocumentError("model did not return valid JSON") from exc
        if not isinstance(structured, dict):
            raise DocumentError("model returned non-object JSON")

        return ParsedDocument(
            markdown=parsed.markdown,
            page_count=parsed.page_count,
            structured=structured,
            provider=self.provider_id,
        )

    async def _summarize(self, markdown: str, *, filename: str) -> str:
        # Cap input so a huge doc can't blow the summary call's context/cost.
        excerpt = markdown[:12_000]
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _SUMMARY_SYSTEM},
                    {"role": "user", "content": f"Filename: {filename}\n\n{excerpt}"},
                ],
            )
            text = (resp.choices[0].message.content or "").strip()
            return text[:600] if text else _summarize(markdown)
        except Exception as exc:  # noqa: BLE001 — never fail a parse on summary
            logger.warning("openai_processor: summary failed for %s: %s", filename, exc)
            return _summarize(markdown)
