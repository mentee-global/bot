from app.agents.base import AgentPort
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread
from app.services.thread_store import ThreadStore


class MessageService:
    def __init__(self, store: ThreadStore, agent: AgentPort) -> None:
        self.store = store
        self.agent = agent

    async def handle_user_message(
        self, session_id: str, body: str
    ) -> tuple[Thread, Message, Message]:
        thread = self.store.get_or_create_for_session(session_id)

        user_message = Message(thread_id=thread.id, role=MessageRole.USER, body=body)
        self.store.append_message(thread, user_message)

        reply_body = await self.agent.reply(user_message, thread.messages)
        assistant_message = Message(
            thread_id=thread.id, role=MessageRole.ASSISTANT, body=reply_body
        )
        self.store.append_message(thread, assistant_message)

        return thread, user_message, assistant_message

    def get_thread(self, session_id: str) -> Thread:
        return self.store.get_or_create_for_session(session_id)
