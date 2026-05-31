"""Document upload endpoints (plan Phase 1).

POST creates a chat attachment, stores the raw bytes, and kicks off async
processing; GET/DELETE are user-scoped. Tenant ownership (plan decision #15):
a `chat_attachment` requires a thread the caller owns, checked before any write.
"""

import hashlib
import logging
from datetime import datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel

from app.api.deps import (
    get_blob_store,
    get_current_user,
    get_document_service,
    get_document_store,
    require_session,
)
from app.core.config import settings
from app.documents.base import BlobStorePort, DocPurpose
from app.documents.service import DocumentService, ThreadOwnershipError, blob_key
from app.documents.store import DocumentNotFoundError, DocumentStore
from app.domain.models import Document, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])


class DocumentResponse(BaseModel):
    id: str
    thread_id: str | None
    purpose: str
    filename: str
    mime_type: str
    size_bytes: int
    status: str
    summary: str | None
    page_count: int | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_document(cls, d: Document) -> "DocumentResponse":
        return cls(
            id=d.id,
            thread_id=d.thread_id,
            purpose=d.purpose,
            filename=d.filename,
            mime_type=d.mime_type,
            size_bytes=d.size_bytes,
            status=d.status,
            summary=d.summary,
            page_count=d.page_count,
            error_message=d.error_message,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    background: BackgroundTasks,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[DocumentService, Depends(get_document_service)],
    store: Annotated[DocumentStore, Depends(get_document_store)],
    blobs: Annotated[BlobStorePort, Depends(get_blob_store)],
    file: Annotated[UploadFile, File()],
    purpose: Annotated[str, Form()] = DocPurpose.CHAT_ATTACHMENT,
    thread_id: Annotated[str | None, Form()] = None,
) -> DocumentResponse:
    # CV upload (profile_cv) ships in plan Phase 2.
    if purpose != DocPurpose.CHAT_ATTACHMENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported purpose {purpose!r} (only chat_attachment in this release)",
        )
    if not thread_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="thread_id is required for a chat attachment",
        )

    mime = file.content_type or "application/octet-stream"
    if mime not in settings.allowed_upload_mimes:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {mime}",
        )

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file"
        )
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.max_upload_bytes} bytes",
        )

    # Ownership BEFORE any write (plan decision #15).
    try:
        await service.assert_thread_owned(user_id=user.id, thread_id=thread_id)
    except ThreadOwnershipError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from exc

    file_hash = hashlib.sha256(data).hexdigest()
    doc = await store.create_document(
        user_id=user.id,
        thread_id=thread_id,
        purpose=DocPurpose.CHAT_ATTACHMENT,
        filename=file.filename or "upload",
        mime_type=mime,
        size_bytes=len(data),
        file_hash=file_hash,
    )
    key = blob_key(user.id, doc.id)
    uri = await blobs.put(key=key, data=data, content_type=mime)
    doc = await store.update_document(doc.id, storage_uri=uri)

    background.add_task(
        service.process_chat_upload,
        user_id=user.id,
        thread_id=thread_id,
        document_id=doc.id,
    )
    return DocumentResponse.from_document(doc)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: str,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    store: Annotated[DocumentStore, Depends(get_document_store)],
) -> DocumentResponse:
    try:
        doc = await store.get_document(document_id, user.id)
    except DocumentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        ) from exc
    return DocumentResponse.from_document(doc)


@router.get("/{document_id}/raw")
async def get_document_raw(
    document_id: str,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    store: Annotated[DocumentStore, Depends(get_document_store)],
    blobs: Annotated[BlobStorePort, Depends(get_blob_store)],
) -> Response:
    try:
        doc = await store.get_document(document_id, user.id)
    except DocumentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        ) from exc
    data = await blobs.get(key=blob_key(user.id, document_id))
    return Response(
        content=data,
        media_type=doc.mime_type,
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    store: Annotated[DocumentStore, Depends(get_document_store)],
    blobs: Annotated[BlobStorePort, Depends(get_blob_store)],
) -> None:
    try:
        await store.delete_document(document_id, user.id)
    except DocumentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        ) from exc
    # Best-effort blob cleanup; the row is already gone.
    try:
        await blobs.delete(key=blob_key(user.id, document_id))
    except Exception as exc:  # noqa: BLE001
        logger.warning("blob delete failed for %s: %s", document_id, exc)
