import type {
	SendMessageResponse,
	Thread,
} from "#/features/chat/data/chat.types";
import { api } from "#/lib/api/client";

export const chatService = {
	getThread: (signal?: AbortSignal) =>
		api.get<Thread>("/api/chat/thread", signal),
	sendMessage: (body: string) =>
		api.post<SendMessageResponse>("/api/chat/messages", { body }),
};
