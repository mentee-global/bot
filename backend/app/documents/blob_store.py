"""Raw-byte storage.

`DiskBlobStore` is the MVP default — writes under `settings.blob_store_path`
(a Railway volume in prod, a temp dir in dev). Owning the bytes (rather than
relying only on an OpenAI file id) lets us serve originals back and re-process
with a different engine later. S3/R2 is plan Phase 3, added behind this port.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.documents.base import BlobStorePort


class DiskBlobStore(BlobStorePort):
    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)

    def _path(self, key: str) -> Path:
        # Keys are server-generated (e.g. "<user_id>/<doc_id>"); still guard
        # against traversal by resolving and confirming containment.
        target = (self._root / key).resolve()
        root = self._root.resolve()
        if root not in target.parents and target != root:
            raise ValueError(f"blob key escapes storage root: {key!r}")
        return target

    async def put(self, *, key: str, data: bytes, content_type: str) -> str:
        path = self._path(key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        await asyncio.to_thread(_write)
        return f"file://{path}"

    async def get(self, *, key: str) -> bytes:
        path = self._path(key)
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, *, key: str) -> None:
        path = self._path(key)
        await asyncio.to_thread(path.unlink, True)  # missing_ok=True

    async def signed_url(self, *, key: str, ttl_s: int = 300) -> str:
        # Disk has no native signing. Downloads are proxied through an
        # authenticated backend route (added in Phase 1); the S3 impl (Phase 3)
        # returns a real presigned URL. Return the internal API path for now.
        return f"/api/documents/{key}/raw"
