import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chatService } from "#/features/chat/data/chat.service";
import { streamChatMessage } from "#/features/chat/data/chat.stream";
import type {
	Message,
	StreamDone,
	StreamMeta,
	Thread,
	ToolEvent,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";
import { toolActivityStore } from "#/features/chat/hooks/useToolActivity";

function nowIso(): string {
	return new Date().toISOString();
}

function patchThread(
	queryClient: ReturnType<typeof useQueryClient>,
	updater: (thread: Thread) => Thread,
	thread_id?: string,
) {
	queryClient.setQueryData<Thread>(chatKeys.thread(), (prev) => {
		const base: Thread = prev ?? {
			thread_id: thread_id ?? "",
			messages: [],
		};
		return updater(base);
	});
}

/**
 * Streaming counterpart to `useSendMessageMutation`.
 *
 * Flow: POST `/api/chat/messages/stream`, parse SSE frames, patch the shared
 * TanStack Query cache (`chatKeys.thread()`) so the existing ChatView renders
 * the user + assistant message bubbles token-by-token without a refetch.
 *
 * If the stream fails (network error, non-2xx, abort), we transparently fall
 * back to the existing non-streaming `POST /api/chat/messages` endpoint —
 * the mutation resolves successfully from the user's perspective.
 */
export function useStreamMessage() {
	const queryClient = useQueryClient();

	return useMutation<void, Error, string>({
		mutationFn: async (body: string) => {
			let meta: StreamMeta | null = null;
			let accumulated = "";
			const pendingUserId = `temp-user-${Date.now()}`;

			try {
				for await (const evt of streamChatMessage(body)) {
					if (evt.event === "meta") {
						meta = JSON.parse(evt.data) as StreamMeta;
						const userMessage: Message = {
							id: meta.user_message_id,
							thread_id: meta.thread_id,
							role: "user",
							body,
							created_at: nowIso(),
						};
						const assistantMessage: Message = {
							id: meta.assistant_message_id,
							thread_id: meta.thread_id,
							role: "assistant",
							body: "",
							created_at: nowIso(),
							streaming: true,
						};
						patchThread(
							queryClient,
							(t) => ({
								thread_id: meta?.thread_id ?? t.thread_id,
								messages: [...t.messages, userMessage, assistantMessage],
							}),
							meta.thread_id,
						);
					} else if (evt.event === "token") {
						if (!meta) continue;
						const delta = safeParseTokenPayload(evt.data);
						if (!delta) continue;
						accumulated += delta;
						patchThread(queryClient, (t) => ({
							thread_id: t.thread_id,
							messages: t.messages.map((m) =>
								m.id === meta?.assistant_message_id
									? { ...m, body: accumulated }
									: m,
							),
						}));
					} else if (evt.event === "tool") {
						if (!meta) continue;
						const toolEvt = JSON.parse(evt.data) as ToolEvent;
						if (toolEvt.status === "running") {
							toolActivityStore.start(meta.assistant_message_id, {
								tool_call_id: toolEvt.tool_call_id,
								name: toolEvt.name,
								source: toolEvt.source,
							});
						} else {
							toolActivityStore.end(
								meta.assistant_message_id,
								toolEvt.tool_call_id,
								toolEvt.outcome,
							);
						}
					} else if (evt.event === "done") {
						const done = JSON.parse(evt.data) as StreamDone;
						patchThread(queryClient, (t) => ({
							thread_id: t.thread_id,
							messages: t.messages.map((m) =>
								m.id === done.assistant_message_id
									? { ...m, body: done.body, streaming: false }
									: m,
							),
						}));
						// Drop chips once the stream is complete; they only make
						// sense while the model is actively working.
						toolActivityStore.clearMessage(done.assistant_message_id);
					} else if (evt.event === "error") {
						throw new Error(evt.data || "stream error");
					}
				}
			} catch (err) {
				// Drop any half-rendered assistant bubble from the optimistic merge
				// so the fallback POST doesn't double-append on success.
				if (meta) {
					toolActivityStore.clearMessage(meta.assistant_message_id);
					const metaIds = {
						userId: meta.user_message_id,
						assistantId: meta.assistant_message_id,
					};
					patchThread(queryClient, (t) => ({
						thread_id: t.thread_id,
						messages: t.messages.filter(
							(m) => m.id !== metaIds.userId && m.id !== metaIds.assistantId,
						),
					}));
				}
				// Also strip the pre-meta optimistic user placeholder if we ever
				// added one.
				patchThread(queryClient, (t) => ({
					thread_id: t.thread_id,
					messages: t.messages.filter((m) => m.id !== pendingUserId),
				}));

				// Fall back to the non-streaming endpoint. If THAT fails too, let
				// the error bubble up — react-query surfaces it through onError.
				const fallback = await chatService.sendMessage(body);
				patchThread(
					queryClient,
					(t) => ({
						thread_id: fallback.thread_id,
						messages: [
							...t.messages,
							fallback.user_message,
							fallback.assistant_message,
						],
					}),
					fallback.thread_id,
				);
				// Don't re-throw — caller sees a successful mutation.
				console.warn("stream failed, used POST fallback:", err);
			}
		},
	});
}

/**
 * Token payloads are JSON-encoded strings (so "\n" and quote characters
 * survive the SSE framing). This unwraps them; if parsing fails we treat
 * the raw data as plain text.
 */
function safeParseTokenPayload(raw: string): string {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "string" ? parsed : String(parsed);
	} catch {
		return raw;
	}
}
