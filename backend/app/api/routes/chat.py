from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_message_service, require_session
from app.domain.models import Message
from app.services.message_service import MessageService

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
    service: Annotated[MessageService, Depends(get_message_service)],
) -> SendMessageResponse:
    thread, user_msg, assistant_msg = await service.handle_user_message(
        session_id=session_id, body=payload.body
    )
    return SendMessageResponse(
        thread_id=thread.id,
        user_message=user_msg,
        assistant_message=assistant_msg,
    )


@router.get("/thread", response_model=ThreadResponse)
async def get_thread(
    session_id: Annotated[str, Depends(require_session)],
    service: Annotated[MessageService, Depends(get_message_service)],
) -> ThreadResponse:
    thread = service.get_thread(session_id)
    return ThreadResponse(thread_id=thread.id, messages=thread.messages)
