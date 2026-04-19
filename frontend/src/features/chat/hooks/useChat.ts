import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { chatService } from "#/features/chat/data/chat.service";
import type {
	SendMessageResponse,
	Thread,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";

export { useStreamMessage } from "#/features/chat/hooks/useStreamMessage";

export const threadQueryOptions = queryOptions({
	queryKey: chatKeys.thread(),
	queryFn: ({ signal }) => chatService.getThread(signal),
});

export function useThreadQuery() {
	return useQuery(threadQueryOptions);
}

export function useSendMessageMutation() {
	const queryClient = useQueryClient();

	return useMutation<SendMessageResponse, Error, string>({
		mutationFn: (body: string) => chatService.sendMessage(body),
		onSuccess: (response) => {
			// Merge both messages into the cached thread so the UI updates instantly
			// without a refetch round-trip.
			queryClient.setQueryData<Thread>(chatKeys.thread(), (prev) => {
				const existing = prev?.messages ?? [];
				return {
					thread_id: response.thread_id,
					messages: [
						...existing,
						response.user_message,
						response.assistant_message,
					],
				};
			});
		},
	});
}
