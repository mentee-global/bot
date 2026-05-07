import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatService } from "#/features/chat/data/chat.service";
import type {
	FeedbackTriggerConfig,
	Message,
	MessageRating,
	RateThreadResponse,
	Thread,
	ThreadRating,
	ThreadStars,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";
import { track } from "#/lib/analytics";
import type { ApiError } from "#/lib/api/errors";
import { m } from "#/paraglide/messages";

interface RateMessageVars {
	messageId: string;
	threadId: string;
	rating: -1 | 0 | 1;
	priorRating: MessageRating | null | undefined;
}

/**
 * Submit/clear thumbs feedback on an assistant message.
 *
 * Optimistic: the message's `rating` flips immediately in the thread cache so
 * the UI feels free. On failure we revert and surface a toast — feedback is
 * always optional, never blocks the conversation.
 */
export function useSubmitMessageRatingMutation() {
	const queryClient = useQueryClient();

	return useMutation<
		{ ok: true },
		Error,
		RateMessageVars,
		{ rolledBack: boolean }
	>({
		mutationFn: ({ messageId, rating }) =>
			chatService.rateMessage(messageId, rating),
		onMutate: ({ messageId, threadId, rating, priorRating }) => {
			const cacheKey = chatKeys.thread(threadId);
			queryClient.setQueryData<Thread>(cacheKey, (prev) => {
				if (!prev) return prev;
				return {
					...prev,
					messages: prev.messages.map((msg: Message) =>
						msg.id === messageId
							? {
									...msg,
									rating: rating === 0 ? null : (rating as MessageRating),
								}
							: msg,
					),
				};
			});
			track("chat.message_rated", {
				message_id: messageId,
				thread_id: threadId,
				rating,
				prior_rating: priorRating ?? 0,
			});
			return { rolledBack: false };
		},
		onError: (_err, vars, _ctx) => {
			const cacheKey = chatKeys.thread(vars.threadId);
			queryClient.setQueryData<Thread>(cacheKey, (prev) => {
				if (!prev) return prev;
				return {
					...prev,
					messages: prev.messages.map((msg: Message) =>
						msg.id === vars.messageId
							? { ...msg, rating: vars.priorRating ?? null }
							: msg,
					),
				};
			});
			toast.error(m.chat_feedback_failed_toast());
		},
	});
}

interface RateThreadVars {
	threadId: string;
	stars: ThreadStars;
	comment?: string | null;
}

/**
 * Submit (or overwrite) the per-conversation star rating.
 *
 * Idempotent on the server (upsert by thread_id) so retries are safe. The
 * caller passes its own `onSuccess`/`onError` to drive the trigger-hook state
 * machine; this hook only owns the network + cache + toast.
 */
export function useSubmitSessionRatingMutation() {
	const queryClient = useQueryClient();

	return useMutation<RateThreadResponse, Error, RateThreadVars>({
		mutationFn: ({ threadId, stars, comment }) =>
			chatService.rateThread(threadId, { stars, comment }),
		onSuccess: (data, vars) => {
			queryClient.setQueryData<ThreadRating | null>(
				chatKeys.threadRating(vars.threadId),
				data.rating,
			);
		},
		onError: () => {
			toast.error(m.chat_session_rating_failed_toast());
		},
	});
}

/**
 * Read the caller's session rating for a thread, if any.
 *
 * Used by the trigger hook to short-circuit on threads the user has already
 * rated from another device — localStorage doesn't sync, so this is the
 * source of truth on a fresh client.
 */
export function useThreadRatingQuery(threadId: string | null | undefined) {
	return useQuery<ThreadRating | null, ApiError>({
		queryKey: chatKeys.threadRating(threadId ?? ""),
		queryFn: async ({ signal }) => {
			if (!threadId) return null;
			const res = await chatService.getThreadRating(threadId, signal);
			return res.rating;
		},
		enabled: Boolean(threadId),
		staleTime: 60_000,
	});
}

/**
 * Read the admin-controlled cadence config that drives the in-chat session
 * rating prompt. Returned to the trigger hook so it can honor changes
 * without a redeploy. Cached for 5 minutes — the value is shared across all
 * users and rarely changes, so this is gentle on the backend.
 */
export function useFeedbackTriggerConfigQuery() {
	return useQuery<FeedbackTriggerConfig, ApiError>({
		queryKey: chatKeys.feedbackTriggerConfig(),
		queryFn: ({ signal }) => chatService.getFeedbackTriggerConfig(signal),
		staleTime: 5 * 60 * 1000,
	});
}
