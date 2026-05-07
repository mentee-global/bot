import type { PersonaPayload } from "#/features/admin/data/persona.types";
import type {
	FeedbackTriggerConfig,
	GetThreadRatingResponse,
	RateThreadResponse,
	SendMessageResponse,
	Thread,
	ThreadListResponse,
	ThreadStars,
} from "#/features/chat/data/chat.types";
import { api } from "#/lib/api/client";
import { getLocale } from "#/paraglide/runtime";

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
		return api.post<SendMessageResponse>(
			"/api/chat/messages",
			payload,
			undefined,
			{ "X-UI-Locale": getLocale() },
		);
	},
	/** Submit a thumbs rating on an assistant message. Pass 0 to clear. */
	rateMessage: (messageId: string, rating: -1 | 0 | 1) =>
		api.post<{ ok: true }>(
			`/api/chat/messages/${encodeURIComponent(messageId)}/rating`,
			{ rating },
		),
	/** Submit (or overwrite) the per-conversation 1–5 star rating. */
	rateThread: (
		threadId: string,
		body: { stars: ThreadStars; comment?: string | null },
	) =>
		api.post<RateThreadResponse>(
			`/api/chat/threads/${encodeURIComponent(threadId)}/rating`,
			body,
		),
	getThreadRating: (threadId: string, signal?: AbortSignal) =>
		api.get<GetThreadRatingResponse>(
			`/api/chat/threads/${encodeURIComponent(threadId)}/rating`,
			signal,
		),
	/** User-facing read of the admin-controlled rating-prompt cadence config. */
	getFeedbackTriggerConfig: (signal?: AbortSignal) =>
		api.get<FeedbackTriggerConfig>(
			"/api/chat/feedback-trigger-config",
			signal,
		),
};
