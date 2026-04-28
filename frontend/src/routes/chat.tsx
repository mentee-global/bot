import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Menu, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PersonaActiveBanner } from "#/features/admin/components/PersonaActiveBanner";
import { PersonaSheet } from "#/features/admin/components/PersonaSheet";
import { sessionQueryOptions } from "#/features/auth/data/auth.service";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";
import { CreditsPill } from "#/features/budget/components/CreditsPill";
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
		if (session.isPending) return;
		if (!session.data) {
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
			<ChatView
				userName={session.data.name}
				isAdmin={session.data.role === "admin"}
			/>
		</PageShell>
	);
}

function PageShell({ children }: { children: React.ReactNode }) {
	// Cap the chat card to the viewport so the page never scrolls. The
	// subtracted total covers header (4rem) + footer (~4rem) + this main's
	// own padding, which differs by breakpoint (2rem mobile, 3.5rem desktop).
	// `dvh` keeps it honest on mobile Safari where `vh` overcounts against
	// the URL bar.
	return (
		<main className="page-wrap px-3 pb-4 pt-4 sm:px-4 sm:pb-8 sm:pt-6">
			<section className="surface-card relative flex h-[calc(100dvh-10rem)] overflow-hidden sm:h-[calc(100dvh-11.5rem)]">
				{children}
			</section>
		</main>
	);
}

function ChatViewSkeleton() {
	return (
		<div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-5">
			<MessageListSkeleton />
		</div>
	);
}

function ChatView({
	userName,
	isAdmin,
}: {
	userName: string;
	isAdmin: boolean;
}) {
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
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [personaSheetOpen, setPersonaSheetOpen] = useState(false);

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
				setSidebarOpen(false);
				navigate({
					search: { threadId: created.thread_id },
					replace: false,
				});
			},
		});
	};

	const handleSelect = (threadId: string) => {
		setSidebarOpen(false);
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
				isOpenMobile={sidebarOpen}
				onCloseMobile={() => setSidebarOpen(false)}
			/>
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<header className="flex items-center justify-between gap-2 border-b border-[var(--theme-border)] px-3 py-3 sm:px-5">
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label={m.chat_open_sidebar_aria()}
						className="-ml-1 rounded-md p-2 text-[var(--theme-muted)] transition hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)] md:hidden"
					>
						<Menu size={18} />
					</button>
					<div className="min-w-0 flex-1">
						<p className="island-kicker m-0">{m.chat_kicker()}</p>
						<p className="m-0 truncate text-sm text-[var(--theme-secondary)]">
							{m.chat_signed_in_as({ name: userName })}
						</p>
					</div>
					<div className="hidden sm:block">
						<CreditsPill />
					</div>
					{isAdmin ? (
						<>
							<button
								type="button"
								onClick={() => setPersonaSheetOpen(true)}
								className="hidden shrink-0 items-center gap-1.5 rounded-md border border-[var(--theme-border)] px-2.5 py-1.5 text-sm font-medium text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-primary)] sm:inline-flex"
							>
								<Sparkles className="size-3.5" />
								Test persona
							</button>
							<Link
								to="/admin"
								className="shrink-0 text-sm font-medium text-[var(--theme-muted)] underline-offset-4 transition hover:text-[var(--theme-primary)] hover:underline"
							>
								{m.chat_admin_panel_link()}
							</Link>
						</>
					) : null}
					<button
						type="button"
						onClick={() => logout.mutate()}
						className="btn-secondary shrink-0"
					>
						{m.chat_sign_out()}
					</button>
				</header>
				<div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
					{isAdmin ? (
						<PersonaActiveBanner onEdit={() => setPersonaSheetOpen(true)} />
					) : null}
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
			{isAdmin ? (
				<PersonaSheet
					open={personaSheetOpen}
					onOpenChange={setPersonaSheetOpen}
				/>
			) : null}
		</>
	);
}
