import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

import logfire
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, get_message_service, require_session
from app.domain.models import Message, User
from app.services.message_service import MessageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class SendMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class SendMessageResponse(BaseModel):
    thread_id: str
    user_message: Message
    assistant_message: Message


class ThreadResponse(BaseModel):
    thread_id: str
    messages: list[Message]


@router.post("/messages", response_model=SendMessageResponse)
async def send_message(
    payload: SendMessageRequest,
    session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> SendMessageResponse:
    with logfire.span(
        "chat.send_message",
        session_id_prefix=session_id[:8],
        user_id=user.id,
        stream=False,
    ):
        thread, user_msg, assistant_msg = await service.handle_user_message(
            session_id=session_id, body=payload.body, user=user
        )
        return SendMessageResponse(
            thread_id=thread.id,
            user_message=user_msg,
            assistant_message=assistant_msg,
        )


def _sse(event: str, data: object) -> bytes:
    """Format a Server-Sent Event frame."""
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n".encode()


@router.post("/messages/stream")
async def stream_message(
    payload: SendMessageRequest,
    session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[bytes]:
        with logfire.span(
            "chat.stream_message",
            session_id_prefix=session_id[:8],
            user_id=user.id,
            stream=True,
        ):
            try:
                async for event, data in service.stream_user_message(
                    session_id=session_id, body=payload.body, user=user
                ):
                    yield _sse(event, data)
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


@router.get("/thread", response_model=ThreadResponse)
async def get_thread(
    session_id: Annotated[str, Depends(require_session)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> ThreadResponse:
    thread = await service.get_thread(session_id)
    return ThreadResponse(thread_id=thread.id, messages=thread.messages)
