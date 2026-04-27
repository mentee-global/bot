import type { PersonaPayload } from "#/features/admin/data/persona.types";
import type {
	SendMessageResponse,
	Thread,
	ThreadListResponse,
} from "#/features/chat/data/chat.types";
import { api } from "#/lib/api/client";

export const chatService = {
	listThreads: (query?: string, signal?: AbortSignal) => {
		const qs = query ? `?q=${encodeURIComponent(query)}` : "";
		return api.get<ThreadListResponse>(`/api/chat/threads${qs}`, signal);
	},
	createThread: (title?: string) =>
		api.post<Thread>("/api/chat/threads", title ? { title } : {}),
	getThreadById: (threadId: string, signal?: AbortSignal) =>
		api.get<Thread>(
			`/api/chat/threads/${encodeURIComponent(threadId)}`,
			signal,
		),
	renameThread: (threadId: string, title: string) =>
		api.patch<Thread>(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
			title,
		}),
	deleteThread: (threadId: string) =>
		api.delete<void>(`/api/chat/threads/${encodeURIComponent(threadId)}`),
	/** Legacy single-thread endpoint. Kept for backwards compatibility with
	 * callers that don't know a thread id yet. */
	getThread: (signal?: AbortSignal) =>
		api.get<Thread>("/api/chat/thread", signal),
	sendMessage: (body: string, threadId?: string, persona?: PersonaPayload) => {
		const payload: Record<string, unknown> = { body };
		if (threadId) payload.thread_id = threadId;
		if (persona) payload.persona = persona;
		return api.post<SendMessageResponse>("/api/chat/messages", payload);
	},
};
