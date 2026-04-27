import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useActivePersona } from "#/features/admin/hooks/usePersonaStore";
import { budgetKeys } from "#/features/budget/data/budget.service";
import { chatService } from "#/features/chat/data/chat.service";
import type {
	SendMessageResponse,
	Thread,
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
		// Wait for the thread list to resolve a concrete id before firing.
		enabled: !!threadId,
		// setQueryData writes after create/send are authoritative, so avoid
		// an immediate refetch on next render.
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
			queryClient.invalidateQueries({ queryKey: budgetKeys.me() });
		},
	});
}

export function useSendMessageMutation(threadId: string | null | undefined) {
	const queryClient = useQueryClient();
	const persona = useActivePersona();

	return useMutation<SendMessageResponse, Error, string>({
		mutationFn: (body) =>
			chatService.sendMessage(body, threadId ?? undefined, persona),
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
