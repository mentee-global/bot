"""Document ports + data carriers.

These are the ONLY vendor-specific surfaces. A processor takes bytes and
returns portable text / structured data — it never touches the DB, the prompt,
or threading. Orchestration lives in `service.py`; storage in `store.py`.

Swapping OpenAI for LlamaParse later (plan Phase 5) means adding one
`DocumentProcessorPort` implementation — routes, models, and UI are untouched.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum


class DocPurpose(StrEnum):
    CHAT_ATTACHMENT = "chat_attachment"
    PROFILE_CV = "profile_cv"


class DocStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class DocumentError(Exception):
    """Base for document-processing failures."""


class UnsupportedDocumentError(DocumentError):
    """Raised when a processor is handed a MIME type it can't handle."""


@dataclass(slots=True)
class AttachmentFile:
    """A chat attachment's raw bytes, handed to the agent as native multimodal
    input (pydantic-ai `BinaryContent`) — no OCR, no Markdown. Lets the model
    read images (incl. text-free ones), PDFs, etc. directly."""

    filename: str
    mime_type: str
    data: bytes


@dataclass(slots=True)
class DocChunk:
    """A retrieval-sized slice of a parsed document (Phase 4+)."""

    ordinal: int
    text: str
    page: int | None = None
    metadata: dict | None = None


@dataclass(slots=True)
class ParsedDocument:
    """Portable output of a parse/extract. `markdown` is always present;
    `structured` is set only by `extract()` (e.g. a CV). `chunks` stay empty
    until retrieval (Phase 4) needs them.

    `input_tokens` / `output_tokens` / `model_sku` capture the model spend of a
    model-backed parse (multimodal OCR) so the caller can debit credits for it.
    They stay 0/None for local-decode paths (DOCX / typed text) which cost
    nothing."""

    markdown: str
    page_count: int
    summary: str | None = None
    structured: dict | None = None
    chunks: list[DocChunk] = field(default_factory=list)
    provider: str = "unknown"
    provider_file_id: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    model_sku: str | None = None


class DocumentProcessorPort(ABC):
    """Bytes in, structured text out. No DB, no prompt assembly, no threading."""

    provider_id: str = "unknown"

    @abstractmethod
    async def parse(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> ParsedDocument:
        """Transcribe the document into faithful, portable Markdown (+ a short
        summary). For PDFs/images this is multimodal OCR; for typed text
        formats it's a direct decode. Both CVs and chat attachments use this —
        the CV pipeline injects the full Markdown into every chat."""

    def supports(self, mime_type: str) -> bool:
        """Routing hint: can this processor handle the MIME type? Default True."""
        return True


class BlobStorePort(ABC):
    """Raw file bytes. Disk / Railway-volume now, S3 / R2 later (plan Phase 3)."""

    @abstractmethod
    async def put(self, *, key: str, data: bytes, content_type: str) -> str:
        """Persist bytes under `key`; return an opaque storage URI."""

    @abstractmethod
    async def get(self, *, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, *, key: str) -> None: ...

    @abstractmethod
    async def signed_url(self, *, key: str, ttl_s: int = 300) -> str:
        """Time-limited URL to fetch the raw bytes (download originals)."""


class DocumentRetrievalPort(ABC):
    """Index + query document chunks. NOT used in the MVP — added in plan
    Phase 4 (pgvector or OpenAI file_search). Defined here so the seam exists.
    """

    @abstractmethod
    async def index(
        self, *, document_id: str, owner_id: str, scope: str, chunks: list[DocChunk]
    ) -> None: ...

    @abstractmethod
    async def search(
        self, *, owner_id: str, scope: str, query: str, k: int = 8
    ) -> list[DocChunk]: ...

    @abstractmethod
    async def drop(self, *, document_id: str) -> None: ...
