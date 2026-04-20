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
	ThreadListResponse,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";

export { useStreamMessage } from "#/features/chat/hooks/useStreamMessage";

export function threadsQueryOptions(query?: string) {
	return queryOptions({
		queryKey: chatKeys.threads(query),
		queryFn: ({ signal }) => chatService.listThreads(query, signal),
		// Keep the previous list visible while a new search runs so the sidebar
		// doesn't flash empty on every keystroke.
		placeholderData: (prev) => prev,
		staleTime: 15_000,
	});
}

export function threadQueryOptions(threadId: string | null | undefined) {
	return queryOptions({
		queryKey: chatKeys.thread(threadId ?? undefined),
		queryFn: ({ signal }) =>
			threadId
				? chatService.getThreadById(threadId, signal)
				: chatService.getThread(signal),
		// Don't fire a legacy /api/chat/thread request while we're still waiting
		// for the thread list to resolve a concrete id — it would be aborted
		// anyway once activeThreadId flips to threads[0].
		enabled: !!threadId,
		// setQueryData writes after create/send; a 0-staleTime would refetch on
		// the next render even though the cache is already authoritative.
		staleTime: 30_000,
	});
}

export function useThreadsQuery(query?: string) {
	return useQuery(threadsQueryOptions(query));
}

export function useThreadQuery(threadId: string | null | undefined) {
	return useQuery(threadQueryOptions(threadId));
}

export function useCreateThreadMutation() {
	const queryClient = useQueryClient();

	return useMutation<Thread, Error, string | undefined>({
		mutationFn: (title) => chatService.createThread(title),
		onSuccess: (thread) => {
			queryClient.setQueryData<Thread>(
				chatKeys.thread(thread.thread_id),
				thread,
			);
			queryClient.invalidateQueries({ queryKey: chatKeys.threadsRoot() });
		},
	});
}

export function useRenameThreadMutation() {
	const queryClient = useQueryClient();

	return useMutation<Thread, Error, { threadId: string; title: string }>({
		mutationFn: ({ threadId, title }) =>
			chatService.renameThread(threadId, title),
		onSuccess: (thread) => {
			queryClient.setQueryData<Thread>(
				chatKeys.thread(thread.thread_id),
				(prev) => (prev ? { ...prev, title: thread.title } : thread),
			);
			queryClient.invalidateQueries({ queryKey: chatKeys.threadsRoot() });
		},
	});
}

export function useDeleteThreadMutation() {
	const queryClient = useQueryClient();

	return useMutation<void, Error, string>({
		mutationFn: (threadId) => chatService.deleteThread(threadId),
		onSuccess: (_data, threadId) => {
			queryClient.removeQueries({ queryKey: chatKeys.thread(threadId) });
			queryClient.invalidateQueries({ queryKey: chatKeys.threadsRoot() });
		},
	});
}

export function useSendMessageMutation(threadId: string | null | undefined) {
	const queryClient = useQueryClient();

	return useMutation<SendMessageResponse, Error, string>({
		mutationFn: (body) => chatService.sendMessage(body, threadId ?? undefined),
		onSuccess: (response) => {
			queryClient.setQueryData<Thread>(
				chatKeys.thread(response.thread_id),
				(prev) => {
					const existing = prev?.messages ?? [];
					return {
						thread_id: response.thread_id,
						title: prev?.title ?? null,
						messages: [
							...existing,
							response.user_message,
							response.assistant_message,
						],
					};
				},
			);
			queryClient.invalidateQueries({ queryKey: chatKeys.threadsRoot() });
		},
	});
}

// The stream mutation's thread-list invalidation used to reference the old
// singleton key. Surface a helper so useStreamMessage stays thin.
export function invalidateThreadList(
	queryClient: ReturnType<typeof useQueryClient>,
) {
	queryClient.invalidateQueries({ queryKey: chatKeys.threadsRoot() });
}

// Unused externally right now, but kept so the type declaration is complete.
export type { ThreadListResponse };
