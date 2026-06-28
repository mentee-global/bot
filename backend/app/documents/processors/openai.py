"""OpenAI-backed document processor — multimodal OCR → faithful Markdown.

The model transcribes a document into clean, verbatim Markdown that the agent
can read in full:

- **PDF**  → Responses API `input_file` (the model reads the pages natively,
  including scans / image-only PDFs).
- **image** (PNG/JPEG/WebP) → Responses API `input_image` with `detail`.
- **DOCX / text** → local decode (the bytes already carry faithful text, so
  there's nothing to OCR — no model cost).

Transcription follows OpenAI's document-understanding guidance: high
`verbosity` for literal rendering, a prompt that forbids summarizing or
paraphrasing. The whole Markdown is what the CV pipeline injects into every
chat, so fidelity matters more than compression.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging

from openai import AsyncOpenAI

from app.documents.base import (
    DocumentError,
    DocumentProcessorPort,
    ParsedDocument,
)
from app.documents.processors.local import LocalProcessor, _summarize

logger = logging.getLogger(__name__)

_PDF = "application/pdf"
_IMAGES = {"image/png", "image/jpeg", "image/webp"}

# Faithful-transcription prompt (cookbook: "do not summarize or paraphrase").
_OCR_PROMPT = (
    "Transcribe this document into clean, well-structured GitHub-flavored "
    "Markdown. Reproduce ALL of the text verbatim — headings, names, contact "
    "details, dates, bullet points, and tables (use Markdown tables). Preserve "
    "the reading order and structure. Do NOT summarize, paraphrase, translate, "
    "infer, or add any commentary, preamble, or text that is not present in the "
    "document. If a region is unreadable, write [illegible]. Output only the "
    "Markdown transcription."
)

# A document this large is almost certainly not a CV/letter; the OCR request
# stays bounded by the upload size limits, this is a defensive summary cap.
_SUMMARY_CHAR_CAP = 600


class OpenAIDocumentProcessor(DocumentProcessorPort):
    provider_id = "openai"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        local: LocalProcessor | None = None,
        timeout_s: float = 120.0,
    ) -> None:
        # OCR runs in a background task; give it room (multi-page PDFs on a
        # reasoning model can take a while) without blocking forever.
        self._client = AsyncOpenAI(api_key=api_key, timeout=timeout_s)
        self._model = model
        self._local = local or LocalProcessor()

    def supports(self, mime_type: str) -> bool:
        return mime_type in _IMAGES or self._local.supports(mime_type)

    async def parse(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> ParsedDocument:
        # Typed formats already carry faithful text — decode locally, no model.
        if mime_type != _PDF and mime_type not in _IMAGES:
            return await self._local.parse(
                data=data, filename=filename, mime_type=mime_type
            )

        markdown = await self._ocr_markdown(
            data=data, filename=filename, mime_type=mime_type
        )
        if not markdown:
            raise DocumentError(
                f"{filename}: OCR produced no readable text from the document."
            )
        page_count = (
            await asyncio.to_thread(_pdf_page_count, data)
            if mime_type == _PDF
            else 1
        )
        return ParsedDocument(
            markdown=markdown,
            page_count=page_count,
            summary=_summarize(markdown, limit=_SUMMARY_CHAR_CAP),
            provider=self.provider_id,
        )

    async def _ocr_markdown(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> str:
        b64 = base64.b64encode(data).decode("ascii")
        if mime_type in _IMAGES:
            file_part = {
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{b64}",
                # "auto" is the cookbook's low-friction default; dense scans
                # could use "original" but that's a per-failure tweak.
                "detail": "auto",
            }
        else:  # PDF
            file_part = {
                "type": "input_file",
                "filename": filename,
                "file_data": f"data:application/pdf;base64,{b64}",
            }
        try:
            resp = await self._client.responses.create(
                model=self._model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": _OCR_PROMPT},
                            file_part,
                        ],
                    }
                ],
                # High verbosity nudges the model toward literal transcription;
                # OCR is perception, not reasoning, so keep effort low for speed.
                text={"verbosity": "high"},
                reasoning={"effort": "low"},
            )
        except Exception as exc:  # noqa: BLE001 — surface as a processing failure
            raise DocumentError(f"OCR call failed: {exc}") from exc
        return (resp.output_text or "").strip()


def _pdf_page_count(data: bytes) -> int:
    try:
        from pypdf import PdfReader

        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:  # noqa: BLE001 — page count is best-effort metadata
        return 1
