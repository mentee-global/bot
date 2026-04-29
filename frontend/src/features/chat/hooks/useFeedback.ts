import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatService } from "#/features/chat/data/chat.service";
import type {
	Message,
	MessageRating,
	Thread,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";
import { track } from "#/lib/analytics";
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
