"""Raw-byte storage.

`DiskBlobStore` is the local/dev default — writes under
`settings.blob_store_path`. `S3BlobStore` is the durable cloud implementation
for S3-compatible stores such as Railway Buckets and Cloudflare R2. Owning the
bytes (rather than relying only on an OpenAI file id) lets us serve originals
back and re-process with a different engine later.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Literal

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


class S3BlobStore(BlobStorePort):
    """S3-compatible blob store for Railway Buckets/R2/S3.

    The boto3 client is sync, so calls run in worker threads to keep FastAPI's
    event loop from blocking on network I/O.
    """

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None,
        region_name: str | None,
        access_key_id: str,
        secret_access_key: str,
        url_style: Literal["virtual", "path"] = "virtual",
        client: Any | None = None,
    ) -> None:
        self._bucket = bucket
        self._client = client or self._build_client(
            endpoint_url=endpoint_url,
            region_name=region_name,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            url_style=url_style,
        )

    @staticmethod
    def _build_client(
        *,
        endpoint_url: str | None,
        region_name: str | None,
        access_key_id: str,
        secret_access_key: str,
        url_style: Literal["virtual", "path"],
    ) -> Any:
        import boto3
        from botocore.config import Config

        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region_name or "auto",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(s3={"addressing_style": url_style}),
        )

    async def put(self, *, key: str, data: bytes, content_type: str) -> str:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return f"s3://{self._bucket}/{key}"

    async def get(self, *, key: str) -> bytes:
        response = await asyncio.to_thread(
            self._client.get_object,
            Bucket=self._bucket,
            Key=key,
        )
        body = response["Body"]
        try:
            return await asyncio.to_thread(body.read)
        finally:
            close = getattr(body, "close", None)
            if close is not None:
                await asyncio.to_thread(close)

    async def delete(self, *, key: str) -> None:
        await asyncio.to_thread(
            self._client.delete_object,
            Bucket=self._bucket,
            Key=key,
        )

    async def signed_url(self, *, key: str, ttl_s: int = 300) -> str:
        return await asyncio.to_thread(
            self._client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=ttl_s,
        )
