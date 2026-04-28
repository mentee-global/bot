import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated

import logfire
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, get_message_service, require_session
from app.budget.service import (
    BudgetError,
    GlobalBudgetExhaustedError,
    QuotaExhaustedError,
)
from app.core.rate_limit import limiter
from app.domain.models import MenteeProfile, Message, User
from app.services.message_service import MessageService
from app.services.thread_store import ThreadNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatPersona(BaseModel):
    """Admin-only override of the user context the agent sees on a turn.

    Mirrors the overridable fields of `User` (name, role, language, timezone)
    plus the full `MenteeProfile` object pulled from Mentee's
    `GET /oauth/profile`. Reusing `MenteeProfile` directly means any field
    added to the profile DTO surfaces in the persona form automatically.
    """

    name: str | None = None
    role: str | None = None
    preferred_language: str | None = None
    timezone: str | None = None
    mentee_profile: MenteeProfile | None = None


class SendMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    thread_id: str | None = None
    persona: ChatPersona | None = None


def _maybe_apply_persona(user: User, persona: ChatPersona | None) -> User | None:
    """Build the agent-facing user when an admin attaches a persona override.

    Non-admins are ignored silently — the field is harmless if it leaks
    through a stale client. Returns `None` when there is nothing to override
    so callers can pass `agent_user=None` and the service falls back to `user`.
    """
    if persona is None or user.role != "admin":
        return None
    updates: dict[str, object] = {}
    if persona.name is not None:
        updates["name"] = persona.name
    if persona.role is not None:
        updates["role"] = persona.role
    if persona.preferred_language is not None:
        updates["preferred_language"] = persona.preferred_language
    if persona.timezone is not None:
        updates["timezone"] = persona.timezone
    if persona.mentee_profile is not None:
        updates["mentee_profile"] = persona.mentee_profile
    if not updates:
        return None
    return user.model_copy(update=updates)


class SendMessageResponse(BaseModel):
    thread_id: str
    user_message: Message
    assistant_message: Message


class ThreadResponse(BaseModel):
    thread_id: str
    title: str | None = None
    messages: list[Message]


class ThreadSummary(BaseModel):
    thread_id: str
    title: str | None = None
    created_at: datetime
    updated_at: datetime


class ThreadListResponse(BaseModel):
    threads: list[ThreadSummary]


class CreateThreadRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class RenameThreadRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


@router.post("/messages", response_model=SendMessageResponse)
@limiter.limit("30/minute")
async def send_message(
    request: Request,
    payload: SendMessageRequest,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> SendMessageResponse:
    with logfire.span(
        "chat.send_message",
        user_id=user.id,
        stream=False,
    ):
        try:
            thread, user_msg, assistant_msg = await service.handle_user_message(
                user_id=user.id,
                body=payload.body,
                user=user,
                thread_id=payload.thread_id,
                agent_user=_maybe_apply_persona(user, payload.persona),
            )
        except QuotaExhaustedError as err:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "code": "quota_exhausted",
                    "credits_remaining": err.credits_remaining,
                    "resets_at": err.resets_at.isoformat(),
                },
            ) from err
        except GlobalBudgetExhaustedError as err:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "budget_exhausted",
                    "resets_at": err.resets_at.isoformat(),
                },
            ) from err
        except ThreadNotFoundError as err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
            ) from err
        return SendMessageResponse(
            thread_id=thread.id,
            user_message=user_msg,
            assistant_message=assistant_msg,
        )


def _sse(event: str, data: object) -> bytes:
    """Format a Server-Sent Event frame.

    Payloads are always JSON-encoded so strings containing newlines or other
    SSE-special characters survive the `event: …\\ndata: …\\n\\n` framing.
    The frontend always `JSON.parse`s the `data` field.
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


@router.post("/messages/stream")
@limiter.limit("30/minute")
async def stream_message(
    request: Request,
    payload: SendMessageRequest,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[bytes]:
        with logfire.span(
            "chat.stream_message",
            user_id=user.id,
            stream=True,
        ):
            try:
                async for event, data in service.stream_user_message(
                    user_id=user.id,
                    body=payload.body,
                    user=user,
                    thread_id=payload.thread_id,
                    agent_user=_maybe_apply_persona(user, payload.persona),
                ):
                    yield _sse(event, data)
            except QuotaExhaustedError as err:
                yield _sse(
                    "error",
                    {
                        "code": "quota_exhausted",
                        "credits_remaining": err.credits_remaining,
                        "resets_at": err.resets_at.isoformat(),
                    },
                )
            except GlobalBudgetExhaustedError as err:
                yield _sse(
                    "error",
                    {
                        "code": "budget_exhausted",
                        "resets_at": err.resets_at.isoformat(),
                    },
                )
            except BudgetError:
                yield _sse(
                    "error",
                    {"code": "budget_error", "message": "Chat is paused."},
                )
            except ThreadNotFoundError:
                yield _sse(
                    "error",
                    {"code": "thread_not_found", "message": "Thread not found"},
                )
            except Exception as exc:  # noqa: BLE001 — surface to client as an error event
                logger.exception("stream_message failed: %s", exc)
                yield _sse(
                    "error",
                    {"code": "agent_failure", "message": "Agent run failed"},
                )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/threads", response_model=ThreadListResponse)
async def list_threads(
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
    q: Annotated[str | None, Query(max_length=128)] = None,
) -> ThreadListResponse:
    threads = await service.list_threads(user.id, query=q)
    return ThreadListResponse(
        threads=[
            ThreadSummary(
                thread_id=t.id,
                title=t.title,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
            for t in threads
        ]
    )


@router.post("/threads", response_model=ThreadResponse, status_code=201)
async def create_thread(
    payload: CreateThreadRequest,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> ThreadResponse:
    thread = await service.create_thread(user.id, title=payload.title)
    return ThreadResponse(
        thread_id=thread.id, title=thread.title, messages=thread.messages
    )


@router.get("/threads/{thread_id}", response_model=ThreadResponse)
async def get_thread_by_id(
    thread_id: str,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> ThreadResponse:
    try:
        thread = await service.get_thread(user.id, thread_id)
    except ThreadNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from err
    return ThreadResponse(
        thread_id=thread.id, title=thread.title, messages=thread.messages
    )


@router.patch("/threads/{thread_id}", response_model=ThreadResponse)
async def rename_thread(
    thread_id: str,
    payload: RenameThreadRequest,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> ThreadResponse:
    try:
        thread = await service.rename_thread(user.id, thread_id, payload.title)
    except ThreadNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from err
    return ThreadResponse(
        thread_id=thread.id, title=thread.title, messages=thread.messages
    )


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(
    thread_id: str,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> None:
    try:
        await service.delete_thread(user.id, thread_id)
    except ThreadNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from err


@router.get("/thread", response_model=ThreadResponse)
async def get_thread(
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> ThreadResponse:
    thread = await service.get_thread(user.id)
    return ThreadResponse(
        thread_id=thread.id, title=thread.title, messages=thread.messages
    )
