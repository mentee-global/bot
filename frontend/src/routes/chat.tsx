import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { sessionQueryOptions } from "#/features/auth/data/auth.service";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";
import { ChatInput } from "#/features/chat/components/ChatInput";
import { MessageListSkeleton } from "#/features/chat/components/ChatSkeletons";
import { ChatWelcome } from "#/features/chat/components/ChatWelcome";
import { ConfirmDeleteThreadDialog } from "#/features/chat/components/ConfirmDeleteThreadDialog";
import { MessageList } from "#/features/chat/components/MessageList";
import { RenameThreadDialog } from "#/features/chat/components/RenameThreadDialog";
import { ThreadSidebar } from "#/features/chat/components/ThreadSidebar";
import type { ThreadSummary } from "#/features/chat/data/chat.types";
import {
	useCreateThreadMutation,
	useDeleteThreadMutation,
	useRenameThreadMutation,
	useSendMessageMutation,
	useStreamMessage,
	useThreadQuery,
	useThreadsQuery,
} from "#/features/chat/hooks/useChat";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { m } from "#/paraglide/messages";

const STREAMING_ENABLED = import.meta.env.VITE_AGENT_STREAM !== "false";

type ChatSearch = { threadId?: string };

export const Route = createFileRoute("/chat")({
	component: ChatPage,
	validateSearch: (search: Record<string, unknown>): ChatSearch => ({
		threadId: typeof search.threadId === "string" ? search.threadId : undefined,
	}),
});

function ChatPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const session = useSession();

	useEffect(() => {
		queryClient.invalidateQueries({
			queryKey: sessionQueryOptions.queryKey,
		});
	}, [queryClient]);

	useEffect(() => {
		if (!session.isPending && !session.data) {
			navigate({ to: "/" });
		}
	}, [session.isPending, session.data, navigate]);

	if (session.isPending) {
		return (
			<PageShell>
				<ChatViewSkeleton />
			</PageShell>
		);
	}

	if (!session.data) {
		return null;
	}

	return (
		<PageShell>
			<ChatView userName={session.data.name} />
		</PageShell>
	);
}

function PageShell({ children }: { children: React.ReactNode }) {
	return (
		<main className="page-wrap px-4 pb-8 pt-6">
			<section className="surface-card flex h-[calc(100vh-10rem)] overflow-hidden">
				{children}
			</section>
		</main>
	);
}

function ChatViewSkeleton() {
	return (
		<div className="flex flex-1 items-center justify-center px-5 py-6">
			<MessageListSkeleton />
		</div>
	);
}

function ChatView({ userName }: { userName: string }) {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	const [searchQuery, setSearchQuery] = useState("");
	const debouncedQuery = useDebouncedValue(searchQuery.trim(), 200);

	const threads = useThreadsQuery(debouncedQuery || undefined);
	const createThread = useCreateThreadMutation();
	const deleteThread = useDeleteThreadMutation();
	const renameThread = useRenameThreadMutation();
	const logout = useLogoutMutation();

	const [renameTarget, setRenameTarget] = useState<ThreadSummary | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);

	const activeThreadId = useMemo(() => {
		if (search.threadId) return search.threadId;
		if (debouncedQuery) return null; // don't auto-pick a searched result
		return threads.data?.threads[0]?.thread_id ?? null;
	}, [search.threadId, threads.data, debouncedQuery]);

	const thread = useThreadQuery(activeThreadId);
	const streamMessage = useStreamMessage(activeThreadId);
	const sendMessage = useSendMessageMutation(activeThreadId);
	const send = STREAMING_ENABLED ? streamMessage : sendMessage;
	const messages = thread.data?.messages ?? [];

	const handleCreate = () => {
		createThread.mutate(undefined, {
			onSuccess: (created) => {
				setSearchQuery("");
				navigate({
					search: { threadId: created.thread_id },
					replace: false,
				});
			},
		});
	};

	const handleSelect = (threadId: string) => {
		if (threadId === activeThreadId) return;
		navigate({ search: { threadId }, replace: false });
	};

	const handleConfirmDelete = (threadId: string) => {
		deleteThread.mutate(threadId, {
			onSuccess: () => {
				setDeleteTarget(null);
				if (threadId !== activeThreadId) return;
				const next = threads.data?.threads.find(
					(t) => t.thread_id !== threadId,
				);
				navigate({
					search: next ? { threadId: next.thread_id } : {},
					replace: true,
				});
			},
		});
	};

	const handleConfirmRename = (threadId: string, title: string) => {
		renameThread.mutate(
			{ threadId, title },
			{
				onSuccess: () => setRenameTarget(null),
			},
		);
	};

	const isEmptyThread = messages.length === 0 && !send.isPending;
	const threadsLoading = threads.isPending;
	const threadLoading = thread.isPending && activeThreadId !== null;

	return (
		<>
			<ThreadSidebar
				threads={threads.data?.threads ?? []}
				activeThreadId={activeThreadId}
				isLoading={threadsLoading}
				query={searchQuery}
				onQueryChange={setSearchQuery}
				onSelect={handleSelect}
				onCreate={handleCreate}
				onRequestRename={setRenameTarget}
				onRequestDelete={setDeleteTarget}
				isCreating={createThread.isPending}
			/>
			<div className="flex flex-1 flex-col overflow-hidden">
				<header className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
					<div>
						<p className="island-kicker m-0">{m.chat_kicker()}</p>
						<p className="m-0 text-sm text-[var(--theme-secondary)]">
							{m.chat_signed_in_as({ name: userName })}
						</p>
					</div>
					<button
						type="button"
						onClick={() => logout.mutate()}
						className="btn-secondary"
					>
						{m.chat_sign_out()}
					</button>
				</header>
				<div className="flex-1 overflow-y-auto px-5 py-6">
					{threadLoading ? (
						<MessageListSkeleton />
					) : isEmptyThread ? (
						<ChatWelcome
							userName={userName}
							onPickStarter={(prompt) => send.mutate(prompt)}
						/>
					) : (
						<MessageList messages={messages} isReplying={send.isPending} />
					)}
				</div>
				<ChatInput
					onSend={(body) => send.mutate(body)}
					onStop={STREAMING_ENABLED ? streamMessage.stop : undefined}
					canStop={STREAMING_ENABLED}
					isSending={send.isPending}
				/>
			</div>

			<RenameThreadDialog
				thread={renameTarget}
				onCancel={() => setRenameTarget(null)}
				onConfirm={handleConfirmRename}
				isSaving={renameThread.isPending}
			/>
			<ConfirmDeleteThreadDialog
				thread={deleteTarget}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={handleConfirmDelete}
				isDeleting={deleteThread.isPending}
			/>
		</>
	);
}
