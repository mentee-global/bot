"""Document upload & processing.

Phase 0 foundations — see docs/documents/00-document-upload-plan.md.

Hexagonal-lite, mirroring `app/agents/base.py::AgentPort` and
`app/services/thread_store.py::ThreadStore`:

- `base.py`   — the swappable ports (`DocumentProcessorPort`, `BlobStorePort`,
                `DocumentRetrievalPort`) + their data carriers.
- `service.py`— `DocumentService`, the engine-agnostic orchestrator. It is the
                layer that never changes when a processor is swapped.
- `processors/` — concrete `DocumentProcessorPort` implementations.
- `store.py`  — `DocumentStore` port + in-memory / Postgres implementations.
- `blob_store.py` — `BlobStorePort` (raw bytes) + disk implementation.
- `schemas.py`— `ResumeSchema` fed to structured CV extraction.
"""
