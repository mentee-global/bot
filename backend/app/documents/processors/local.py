"""Local, dependency-free document parsing — no LLM, no external API.

Handles the launch scope (plan decision #10a): typed PDF and DOCX via pypdf /
python-docx. Produces portable markdown and a naive summary (first lines).
Anything needing OCR or structured extraction belongs to a processor that
calls a model (`OpenAIDocumentProcessor`, plan Phase 1/2).
"""

from __future__ import annotations

import asyncio
import io

from app.documents.base import (
    DocumentProcessorPort,
    ParsedDocument,
    UnsupportedDocumentError,
)

_PDF = "application/pdf"
_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_TEXT = {"text/plain", "text/markdown"}


def _summarize(markdown: str, *, limit: int = 600) -> str:
    """Cheap fact-sheet: first non-empty lines, capped. Good enough for thread
    memory in the MVP; a model-written summary replaces it in Phase 1 when the
    OpenAI processor is the one parsing."""
    snippet = " ".join(line.strip() for line in markdown.splitlines() if line.strip())
    return snippet[:limit]


class LocalProcessor(DocumentProcessorPort):
    provider_id = "local"

    def supports(self, mime_type: str) -> bool:
        return mime_type == _PDF or mime_type == _DOCX or mime_type in _TEXT

    async def parse(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> ParsedDocument:
        if mime_type == _PDF:
            return await asyncio.to_thread(self._parse_pdf, data)
        if mime_type == _DOCX:
            return await asyncio.to_thread(self._parse_docx, data)
        if mime_type in _TEXT:
            md = data.decode("utf-8", errors="replace")
            return ParsedDocument(
                markdown=md, page_count=1, summary=_summarize(md), provider=self.provider_id
            )
        raise UnsupportedDocumentError(
            f"LocalProcessor cannot parse {mime_type!r} ({filename!r})"
        )

    async def extract(
        self, *, data: bytes, filename: str, mime_type: str, schema: dict
    ) -> ParsedDocument:
        raise UnsupportedDocumentError(
            "LocalProcessor cannot extract structured data — use a model-backed "
            "processor (OpenAIDocumentProcessor) for CV extraction."
        )

    @staticmethod
    def _parse_pdf(data: bytes) -> ParsedDocument:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
        markdown = "\n\n".join(p for p in pages if p)
        return ParsedDocument(
            markdown=markdown,
            page_count=len(reader.pages),
            summary=_summarize(markdown),
            provider="local",
        )

    @staticmethod
    def _parse_docx(data: bytes) -> ParsedDocument:
        from docx import Document as DocxDocument

        doc = DocxDocument(io.BytesIO(data))
        markdown = "\n\n".join(p.text.strip() for p in doc.paragraphs if p.text.strip())
        return ParsedDocument(
            markdown=markdown,
            page_count=1,  # DOCX has no fixed page count without rendering
            summary=_summarize(markdown),
            provider="local",
        )
