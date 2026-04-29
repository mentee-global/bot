import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Literal

import logfire
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, get_message_service, require_session
from app.budget.service import (
    BudgetError,
    GlobalBudgetExhaustedError,
    QuotaExhaustedError,
)
from app.core import posthog_client
from app.core.observability import user_attrs
from app.core.rate_limit import limiter
from app.domain.models import MenteeProfile, Message, User
from app.services.message_service import MessageService
from app.services.thread_store import MessageNotFoundError, ThreadNotFoundError

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


class RateMessageRequest(BaseModel):
    """Wire format for thumbs feedback. 1 = up, -1 = down, 0 = clear.

    Backend persists ±1 only; 0 deletes the underlying `message_ratings` row
    (see `app/services/pg_thread_store.py::set_message_rating`).
    """

    rating: Literal[-1, 0, 1]


@router.post("/messages", response_model=SendMessageResponse)
@limiter.limit("30/minute")
async def send_message(
    request: Request,
    payload: SendMessageRequest,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
    ui_locale: Annotated[str | None, Header(alias="X-UI-Locale")] = None,
) -> SendMessageResponse:
    with logfire.span(
        "chat.send_message",
        **user_attrs(user),
        thread_id=payload.thread_id,
        stream=False,
        message_length=len(payload.body),
        ui_locale=ui_locale,
        persona_override=payload.persona is not None,
    ) as span:
        try:
            thread, user_msg, assistant_msg = await service.handle_user_message(
                user_id=user.id,
                body=payload.body,
                user=user,
                thread_id=payload.thread_id,
                agent_user=_maybe_apply_persona(user, payload.persona),
                ui_locale=ui_locale,
            )
        except QuotaExhaustedError as err:
            span.set_attribute("status", "quota_exhausted")
            span.set_attribute("error_type", type(err).__name__)
            posthog_client.capture(
                user,
                "server.chat.failed",
                {
                    "thread_id": payload.thread_id,
                    "stream": False,
                    "error_type": type(err).__name__,
                    "status_code": 402,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "code": "quota_exhausted",
                    "credits_remaining": err.credits_remaining,
                    "resets_at": err.resets_at.isoformat(),
                },
            ) from err
        except GlobalBudgetExhaustedError as err:
            span.set_attribute("status", "budget_exhausted")
            span.set_attribute("error_type", type(err).__name__)
            posthog_client.capture(
                user,
                "server.chat.failed",
                {
                    "thread_id": payload.thread_id,
                    "stream": False,
                    "error_type": type(err).__name__,
                    "status_code": 503,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "budget_exhausted",
                    "resets_at": err.resets_at.isoformat(),
                },
            ) from err
        except ThreadNotFoundError as err:
            span.set_attribute("status", "thread_not_found")
            span.set_attribute("error_type", type(err).__name__)
            posthog_client.capture(
                user,
                "server.chat.failed",
                {
                    "thread_id": payload.thread_id,
                    "stream": False,
                    "error_type": type(err).__name__,
                    "status_code": 404,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
            ) from err
        span.set_attribute("status", "ok")
        span.set_attribute("resolved_thread_id", thread.id)
        span.set_attribute("response_length", len(assistant_msg.body))
        span.set_attribute("user_message_id", user_msg.id)
        span.set_attribute("assistant_message_id", assistant_msg.id)
        posthog_client.capture(
            user,
            "server.chat.completed",
            {
                "thread_id": thread.id,
                "user_message_id": user_msg.id,
                "assistant_message_id": assistant_msg.id,
                "response_length": len(assistant_msg.body),
                "stream": False,
                "persona_override": payload.persona is not None,
                "ui_locale": ui_locale,
            },
        )
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
    ui_locale: Annotated[str | None, Header(alias="X-UI-Locale")] = None,
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[bytes]:
        with logfire.span(
            "chat.stream_message",
            **user_attrs(user),
            thread_id=payload.thread_id,
            stream=True,
            message_length=len(payload.body),
            ui_locale=ui_locale,
            persona_override=payload.persona is not None,
        ) as span:
            response_length = 0
            resolved_thread_id: str | None = None
            assistant_message_id: str | None = None
            failure: tuple[str, int] | None = None  # (error_type, status_code)
            try:
                async for event, data in service.stream_user_message(
                    user_id=user.id,
                    body=payload.body,
                    user=user,
                    thread_id=payload.thread_id,
                    agent_user=_maybe_apply_persona(user, payload.persona),
                    ui_locale=ui_locale,
                ):
                    if event == "token" and isinstance(data, str):
                        response_length += len(data)
                    elif event == "meta" and isinstance(data, dict):
                        rt = data.get("thread_id")
                        if isinstance(rt, str):
                            resolved_thread_id = rt
                            span.set_attribute("resolved_thread_id", rt)
                        amid = data.get("assistant_message_id")
                        if isinstance(amid, str):
                            assistant_message_id = amid
                    yield _sse(event, data)
            except QuotaExhaustedError as err:
                span.set_attribute("status", "quota_exhausted")
                span.set_attribute("error_type", type(err).__name__)
                failure = (type(err).__name__, 402)
                yield _sse(
                    "error",
                    {
                        "code": "quota_exhausted",
                        "credits_remaining": err.credits_remaining,
                        "resets_at": err.resets_at.isoformat(),
                    },
                )
            except GlobalBudgetExhaustedError as err:
                span.set_attribute("status", "budget_exhausted")
                span.set_attribute("error_type", type(err).__name__)
                failure = (type(err).__name__, 503)
                yield _sse(
                    "error",
                    {
                        "code": "budget_exhausted",
                        "resets_at": err.resets_at.isoformat(),
                    },
                )
            except BudgetError as err:
                span.set_attribute("status", "budget_error")
                span.set_attribute("error_type", type(err).__name__)
                failure = (type(err).__name__, 503)
                yield _sse(
                    "error",
                    {"code": "budget_error", "message": "Chat is paused."},
                )
            except ThreadNotFoundError as err:
                span.set_attribute("status", "thread_not_found")
                span.set_attribute("error_type", type(err).__name__)
                failure = (type(err).__name__, 404)
                yield _sse(
                    "error",
                    {"code": "thread_not_found", "message": "Thread not found"},
                )
            except Exception as exc:  # noqa: BLE001 — surface to client as an error event
                span.set_attribute("status", "agent_failure")
                span.set_attribute("error_type", type(exc).__name__)
                failure = (type(exc).__name__, 500)
                logger.exception("stream_message failed: %s", exc)
                yield _sse(
                    "error",
                    {"code": "agent_failure", "message": "Agent run failed"},
                )
            else:
                span.set_attribute("status", "ok")
                posthog_client.capture(
                    user,
                    "server.chat.completed",
                    {
                        "thread_id": resolved_thread_id or payload.thread_id,
                        "assistant_message_id": assistant_message_id,
                        "response_length": response_length,
                        "stream": True,
                        "persona_override": payload.persona is not None,
                        "ui_locale": ui_locale,
                    },
                )
            finally:
                span.set_attribute("response_length", response_length)
                if failure is not None:
                    err_type, status_code = failure
                    posthog_client.capture(
                        user,
                        "server.chat.failed",
                        {
                            "thread_id": resolved_thread_id or payload.thread_id,
                            "stream": True,
                            "error_type": err_type,
                            "status_code": status_code,
                            "tokens_received": response_length,
                        },
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


@router.post("/messages/{message_id}/rating")
@limiter.limit("60/minute")
async def rate_message(
    request: Request,
    message_id: str,
    payload: RateMessageRequest,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> dict[str, bool]:
    """Submit a thumbs rating for an assistant message the caller owns.

    Optional and reversible: pass `rating: 0` to clear. The frontend treats
    this as fire-and-forget (optimistic UI in `useFeedback.ts`); failures
    surface as a toast and a state revert.
    """
    with logfire.span(
        "chat.rate_message",
        **user_attrs(user),
        message_id=message_id,
        rating=payload.rating,
    ) as span:
        try:
            await service.rate_message(
                user_id=user.id,
                message_id=message_id,
                rating=payload.rating,
            )
        except MessageNotFoundError as err:
            span.set_attribute("status", "not_found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found",
            ) from err
        span.set_attribute("status", "ok")
    posthog_client.capture(
        user,
        "server.chat.message_rated",
        {"message_id": message_id, "rating": payload.rating},
    )
    return {"ok": True}


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
