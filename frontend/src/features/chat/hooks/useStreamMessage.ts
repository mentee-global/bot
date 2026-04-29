import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useActivePersona } from "#/features/admin/hooks/usePersonaStore";
import { budgetKeys } from "#/features/budget/data/budget.service";
import { chatService } from "#/features/chat/data/chat.service";
import { streamChatMessage } from "#/features/chat/data/chat.stream";
import type {
	Message,
	StreamDone,
	StreamMeta,
	StreamSuggestions,
	Thread,
	ToolEvent,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";
import { toolActivityStore } from "#/features/chat/hooks/useToolActivity";

function nowIso(): string {
	return new Date().toISOString();
}

type QueryClient = ReturnType<typeof useQueryClient>;

function patchThreadByKey(
	queryClient: QueryClient,
	queryKey: readonly unknown[],
	updater: (thread: Thread) => Thread,
	fallbackThreadId?: string,
) {
	queryClient.setQueryData<Thread>(queryKey, (prev) => {
		const base: Thread = prev ?? {
			thread_id: fallbackThreadId ?? "",
			title: null,
			messages: [],
		};
		return updater(base);
	});
}

// On error, we roll back the optimistic bubbles and fall back to the
// non-streaming POST so the user still sees an answer. `stop()` aborts the
// in-flight stream and keeps whatever tokens have accumulated so far.
export function useStreamMessage(
	threadId: string | null | undefined,
	options?: { onThreadResolved?: (threadId: string) => void },
) {
	const queryClient = useQueryClient();
	const abortRef = useRef<AbortController | null>(null);
	const persona = useActivePersona();

	const mutation = useMutation<void, Error, string>({
		mutationFn: async (body: string) => {
			const pendingUserId = `pending-user-${crypto.randomUUID()}`;
			const pendingAssistantId = `pending-assistant-${crypto.randomUUID()}`;
			const activeThreadId = threadId ?? undefined;
			const cacheKey = chatKeys.thread(activeThreadId);

			const controller = new AbortController();
			abortRef.current = controller;

			const optimisticUser: Message = {
				id: pendingUserId,
				thread_id: activeThreadId ?? "",
				role: "user",
				body,
				created_at: nowIso(),
			};
			const optimisticAssistant: Message = {
				id: pendingAssistantId,
				thread_id: activeThreadId ?? "",
				role: "assistant",
				body: "",
				created_at: nowIso(),
				streaming: true,
			};

			patchThreadByKey(
				queryClient,
				cacheKey,
				(t) => ({
					thread_id: t.thread_id || activeThreadId || "",
					title: t.title,
					messages: [...t.messages, optimisticUser, optimisticAssistant],
				}),
				activeThreadId,
			);

			let meta: StreamMeta | null = null;
			let resolvedCacheKey = cacheKey;
			let accumulated = "";
			let titleFromMeta: string | null = null;

			try {
				for await (const evt of streamChatMessage(
					body,
					activeThreadId,
					controller.signal,
					persona,
				)) {
					if (evt.event === "meta") {
						meta = JSON.parse(evt.data) as StreamMeta;
						titleFromMeta = meta.title;
						const metaSnapshot = meta;
						if (!threadId) options?.onThreadResolved?.(meta.thread_id);
						if (
							cacheKey.join("/") !== chatKeys.thread(meta.thread_id).join("/")
						) {
							const existing = queryClient.getQueryData<Thread>(cacheKey);
							resolvedCacheKey = chatKeys.thread(meta.thread_id);
							if (existing) {
								queryClient.setQueryData<Thread>(resolvedCacheKey, {
									...existing,
									thread_id: meta.thread_id,
								});
								queryClient.removeQueries({ queryKey: cacheKey });
							}
						}
						patchThreadByKey(
							queryClient,
							resolvedCacheKey,
							(t) => ({
								thread_id: metaSnapshot.thread_id,
								title: metaSnapshot.title ?? t.title,
								messages: t.messages.map((m) => {
									if (m.id === pendingUserId) {
										return { ...m, id: metaSnapshot.user_message_id };
									}
									if (m.id === pendingAssistantId) {
										return { ...m, id: metaSnapshot.assistant_message_id };
									}
									return m;
								}),
							}),
							metaSnapshot.thread_id,
						);
					} else if (evt.event === "token") {
						if (!meta) continue;
						const delta = safeParseTokenPayload(evt.data);
						if (!delta) continue;
						accumulated += delta;
						const assistantId = meta.assistant_message_id;
						patchThreadByKey(queryClient, resolvedCacheKey, (t) => ({
							thread_id: t.thread_id,
							title: t.title,
							messages: t.messages.map((m) =>
								m.id === assistantId ? { ...m, body: accumulated } : m,
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
						patchThreadByKey(queryClient, resolvedCacheKey, (t) => ({
							thread_id: t.thread_id,
							title: t.title,
							messages: t.messages.map((m) =>
								m.id === done.assistant_message_id
									? { ...m, body: done.body, streaming: false }
									: m,
							),
						}));
						toolActivityStore.clearMessage(done.assistant_message_id);
					} else if (evt.event === "suggestions") {
						if (!meta) continue;
						const payload = JSON.parse(evt.data) as StreamSuggestions;
						const suggestionList = Array.isArray(payload.suggestions)
							? payload.suggestions.filter((s) => typeof s === "string")
							: [];
						const targetId =
							payload.assistant_message_id ?? meta.assistant_message_id;
						patchThreadByKey(queryClient, resolvedCacheKey, (t) => ({
							thread_id: t.thread_id,
							title: t.title,
							messages: t.messages.map((mm) =>
								mm.id === targetId
									? { ...mm, suggestions: suggestionList }
									: mm,
							),
						}));
					} else if (evt.event === "error") {
						throw new Error(evt.data || "stream error");
					}
				}
			} catch (err) {
				const wasAborted =
					controller.signal.aborted ||
					(err instanceof DOMException && err.name === "AbortError");

				if (wasAborted) {
					if (meta) {
						const assistantId = meta.assistant_message_id;
						toolActivityStore.clearMessage(assistantId);
						patchThreadByKey(queryClient, resolvedCacheKey, (t) => ({
							thread_id: t.thread_id,
							title: t.title,
							messages: t.messages.map((m) =>
								m.id === assistantId
									? { ...m, body: accumulated, streaming: false }
									: m,
							),
						}));
					} else {
						// Stopped before meta arrived — drop the optimistic bubbles.
						patchThreadByKey(queryClient, resolvedCacheKey, (t) => ({
							thread_id: t.thread_id,
							title: t.title,
							messages: t.messages.filter(
								(m) => m.id !== pendingUserId && m.id !== pendingAssistantId,
							),
						}));
					}
					if (titleFromMeta) {
						queryClient.invalidateQueries({
							queryKey: chatKeys.threadsRoot(),
						});
					}
					return;
				}

				const cleanupIds = new Set<string>([pendingUserId, pendingAssistantId]);
				if (meta) {
					cleanupIds.add(meta.user_message_id);
					cleanupIds.add(meta.assistant_message_id);
					toolActivityStore.clearMessage(meta.assistant_message_id);
				}
				patchThreadByKey(queryClient, resolvedCacheKey, (t) => ({
					thread_id: t.thread_id,
					title: t.title,
					messages: t.messages.filter((m) => !cleanupIds.has(m.id)),
				}));

				try {
					const fallback = await chatService.sendMessage(
						body,
						activeThreadId,
						persona,
					);
					if (!threadId) options?.onThreadResolved?.(fallback.thread_id);
					const fallbackKey = chatKeys.thread(fallback.thread_id);
					patchThreadByKey(
						queryClient,
						fallbackKey,
						(t) => ({
							thread_id: fallback.thread_id,
							title: t.title,
							messages: [
								...t.messages,
								fallback.user_message,
								fallback.assistant_message,
							],
						}),
						fallback.thread_id,
					);
					console.warn("stream failed, used POST fallback:", err);
				} catch (fallbackErr) {
					// Both stream and POST failed — surface a retry affordance on a
					// synthetic user bubble so the user keeps their message.
					const errorMessage =
						fallbackErr instanceof Error ? fallbackErr.message : "send failed";
					const failedKey = activeThreadId
						? chatKeys.thread(activeThreadId)
						: resolvedCacheKey;
					const failedThreadId =
						(meta?.thread_id ?? activeThreadId ?? "") || "";
					const failedBubble: Message = {
						id: `failed-${crypto.randomUUID()}`,
						thread_id: failedThreadId,
						role: "user",
						body,
						created_at: nowIso(),
						error: { message: errorMessage },
					};
					patchThreadByKey(
						queryClient,
						failedKey,
						(t) => ({
							thread_id: t.thread_id || failedThreadId,
							title: t.title,
							messages: [...t.messages, failedBubble],
						}),
						failedThreadId,
					);
					throw fallbackErr;
				}
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
				}
			}

			if (titleFromMeta) {
				queryClient.invalidateQueries({ queryKey: chatKeys.threadsRoot() });
			}
			queryClient.invalidateQueries({ queryKey: budgetKeys.me() });
		},
	});

	const stop = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	return Object.assign(mutation, { stop });
}

function safeParseTokenPayload(raw: string): string {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "string" ? parsed : String(parsed);
	} catch {
		return raw;
	}
}
