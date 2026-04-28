import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	Keyboard,
	Menu,
	PauseCircle,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/ui/Dialog";
import { PersonaActiveBanner } from "#/features/admin/components/PersonaActiveBanner";
import { PersonaSheet } from "#/features/admin/components/PersonaSheet";
import { sessionQueryOptions } from "#/features/auth/data/auth.service";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";
import { CreditsPill } from "#/features/budget/components/CreditsPill";
import type { MeResponse } from "#/features/budget/data/budget.types";
import { useMeQuery } from "#/features/budget/hooks/useBudget";
import {
	ChatInput,
	type ChatInputHandle,
} from "#/features/chat/components/ChatInput";
import { MessageListSkeleton } from "#/features/chat/components/ChatSkeletons";
import { ChatWelcome } from "#/features/chat/components/ChatWelcome";
import { ConfirmDeleteThreadDialog } from "#/features/chat/components/ConfirmDeleteThreadDialog";
import { stripChatBody } from "#/features/chat/components/MessageBody";
import { MessageList } from "#/features/chat/components/MessageList";
import { RenameThreadDialog } from "#/features/chat/components/RenameThreadDialog";
import { ShortcutsDialog } from "#/features/chat/components/ShortcutsDialog";
import { ThreadSidebar } from "#/features/chat/components/ThreadSidebar";
import type {
	Message,
	Thread,
	ThreadSummary,
} from "#/features/chat/data/chat.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";
import {
	useCreateThreadMutation,
	useDeleteThreadMutation,
	useRenameThreadMutation,
	useSendMessageMutation,
	useStreamMessage,
	useThreadQuery,
	useThreadsQuery,
} from "#/features/chat/hooks/useChat";
import { clearAllDrafts } from "#/features/chat/hooks/useDraftsStore";
import { usePinnedThreads } from "#/features/chat/hooks/usePinnedThreads";
import { toolActivityStore } from "#/features/chat/hooks/useToolActivity";
import { track } from "#/lib/analytics";
import { formatFullTimestamp } from "#/lib/datetime";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { useIsDesktop } from "#/lib/useMediaQuery";
import { useShortcut } from "#/lib/useShortcut";
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
	const queryClient = useQueryClient();

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
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [editConfirm, setEditConfirm] = useState<{
		messageId: string;
		body: string;
	} | null>(null);
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [findActiveIndex, setFindActiveIndex] = useState(0);

	const inputRef = useRef<ChatInputHandle>(null);
	const { pinnedIds, togglePin, removePin } = usePinnedThreads();
	// Shortcuts only register on desktop — phones rarely have a hardware
	// keyboard, and global keydown listeners on touch devices are pure cost.
	const isDesktop = useIsDesktop();

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

	const me = useMeQuery();
	const block = useChatBlockState(me.data);

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
				removePin(threadId);
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

	const handleInlineRename = (threadId: string, title: string) => {
		renameThread.mutate({ threadId, title });
	};

	const handleLogout = useCallback(() => {
		clearAllDrafts();
		logout.mutate();
	}, [logout]);

	const trimLastExchange = useCallback(() => {
		if (!activeThreadId) return null;
		const key = chatKeys.thread(activeThreadId);
		const before = queryClient.getQueryData<Thread>(key);
		if (!before) return null;
		const msgs = before.messages;
		let lastUserIdx = -1;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx === -1) return null;
		const userMsg = msgs[lastUserIdx];
		const trailingAssistantIds = msgs
			.slice(lastUserIdx + 1)
			.filter((mm) => mm.role === "assistant")
			.map((mm) => mm.id);
		queryClient.setQueryData<Thread>(key, {
			...before,
			messages: msgs.slice(0, lastUserIdx),
		});
		for (const id of trailingAssistantIds) {
			toolActivityStore.clearMessage(id);
		}
		return userMsg;
	}, [activeThreadId, queryClient]);

	const handleRetry = useCallback(() => {
		const userMsg = trimLastExchange();
		if (!userMsg) return;
		track("chat.message_retried");
		send.mutate(userMsg.body);
	}, [send, trimLastExchange]);

	const trimFromMessage = useCallback(
		(messageId: string) => {
			if (!activeThreadId) return;
			const key = chatKeys.thread(activeThreadId);
			const before = queryClient.getQueryData<Thread>(key);
			if (!before) return;
			const idx = before.messages.findIndex((mm) => mm.id === messageId);
			if (idx === -1) return;
			const dropped = before.messages.slice(idx);
			queryClient.setQueryData<Thread>(key, {
				...before,
				messages: before.messages.slice(0, idx),
			});
			for (const dm of dropped) {
				if (dm.role === "assistant") toolActivityStore.clearMessage(dm.id);
			}
		},
		[activeThreadId, queryClient],
	);

	const handleEditMessage = useCallback(
		(messageId: string, newBody: string) => {
			const trimmed = newBody.trim();
			if (!trimmed) return;
			const lastUser = [...messages].reverse().find((mm) => mm.role === "user");
			if (lastUser?.id === messageId) {
				trimFromMessage(messageId);
				track("chat.message_edited", { position: "last" });
				send.mutate(trimmed);
				return;
			}
			setEditConfirm({ messageId, body: trimmed });
		},
		[messages, trimFromMessage, send],
	);

	const confirmEdit = useCallback(() => {
		if (!editConfirm) return;
		trimFromMessage(editConfirm.messageId);
		track("chat.message_edited", { position: "older" });
		send.mutate(editConfirm.body);
		setEditConfirm(null);
	}, [editConfirm, trimFromMessage, send]);

	const handleRetryFailed = useCallback(
		(message: Message) => {
			if (!activeThreadId) return;
			const key = chatKeys.thread(activeThreadId);
			const before = queryClient.getQueryData<Thread>(key);
			if (!before) return;
			queryClient.setQueryData<Thread>(key, {
				...before,
				messages: before.messages.filter((mm) => mm.id !== message.id),
			});
			send.mutate(message.body);
		},
		[activeThreadId, queryClient, send],
	);

	const handlePickSuggestion = useCallback(
		(text: string) => {
			if (block) return;
			track("chat.suggestion_picked");
			send.mutate(text);
		},
		[block, send],
	);

	const handleExportThread = useCallback(() => {
		if (!thread.data) return;
		const md = renderThreadMarkdown(thread.data);
		const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		const safeTitle =
			(thread.data.title ?? "conversation")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 60) || "conversation";
		a.href = url;
		a.download = `mentee-${safeTitle}.md`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		track("chat.thread_exported");
		toast.success(m.chat_thread_exported_toast());
	}, [thread.data]);

	const handleCopyThread = useCallback(async () => {
		if (!thread.data) return;
		try {
			await navigator.clipboard.writeText(renderThreadMarkdown(thread.data));
			toast.success(m.chat_thread_copied_toast());
			track("chat.thread_copied");
		} catch {
			toast.error(m.chat_copy_failed_toast());
		}
	}, [thread.data]);

	useShortcut(
		"mod+k",
		() => {
			track("chat.shortcut_used", { shortcut: "new_chat" });
			handleCreate();
		},
		{ when: isDesktop },
	);
	useShortcut(
		"mod+/",
		() => {
			track("chat.shortcut_used", { shortcut: "focus_input" });
			inputRef.current?.focus();
		},
		{ when: isDesktop, allowInInput: true },
	);
	useShortcut(
		"mod+shift+l",
		() => {
			setSidebarOpen((o) => !o);
		},
		{ when: isDesktop },
	);
	useShortcut("?", () => setShortcutsOpen(true), { when: isDesktop });
	useShortcut(
		"mod+f",
		(e) => {
			if (!activeThreadId) return;
			e.preventDefault();
			setFindOpen(true);
		},
		{ when: isDesktop },
	);
	// Esc closes overlays — keep this on every device so the find bar /
	// shortcuts dialog can be dismissed without a mouse on tablet too.
	useShortcut(
		"escape",
		() => {
			if (findOpen) setFindOpen(false);
			else if (shortcutsOpen) setShortcutsOpen(false);
		},
		{ when: findOpen || shortcutsOpen, allowInInput: true },
	);

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
				pinnedIds={pinnedIds}
				onTogglePin={togglePin}
				onQueryChange={setSearchQuery}
				onSelect={handleSelect}
				onCreate={handleCreate}
				onRequestRename={setRenameTarget}
				onInlineRename={handleInlineRename}
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
					<div className="shrink-0">
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
						onClick={() => setShortcutsOpen(true)}
						aria-label={m.chat_shortcuts_open_aria()}
						className="hidden shrink-0 items-center justify-center rounded-md border border-[var(--theme-border)] p-1.5 text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-primary)] md:inline-flex"
					>
						<Keyboard className="size-4" aria-hidden="true" />
					</button>
					<button
						type="button"
						onClick={handleLogout}
						className="btn-secondary shrink-0"
					>
						{m.chat_sign_out()}
					</button>
				</header>
				{activeThreadId && messages.length > 0 && findOpen ? (
					<InThreadFind
						messages={messages}
						query={findQuery}
						activeIndex={findActiveIndex}
						onQueryChange={(q) => {
							setFindQuery(q);
							setFindActiveIndex(0);
						}}
						onClose={() => {
							setFindOpen(false);
							setFindQuery("");
							setFindActiveIndex(0);
						}}
						onNext={() => setFindActiveIndex((i) => i + 1)}
						onPrev={() => setFindActiveIndex((i) => i - 1)}
					/>
				) : null}
				<div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
					{isAdmin ? (
						<PersonaActiveBanner onEdit={() => setPersonaSheetOpen(true)} />
					) : null}
					{threadLoading ? (
						<MessageListSkeleton />
					) : isEmptyThread ? (
						<ChatWelcome
							userName={userName}
							recentThreads={threads.data?.threads ?? []}
							onPickStarter={(prompt) => {
								if (block) return;
								track("chat.starter_picked", { kind: "starter" });
								send.mutate(prompt);
							}}
							onContinue={(threadId) => {
								track("chat.starter_picked", { kind: "continue" });
								handleSelect(threadId);
							}}
							disabled={block !== null}
						/>
					) : (
						<MessageList
							messages={messages}
							isReplying={send.isPending}
							onRetryLast={handleRetry}
							onEditMessage={handleEditMessage}
							onRetryFailed={handleRetryFailed}
							onPickSuggestion={handlePickSuggestion}
							onExportThread={handleExportThread}
							onCopyThread={handleCopyThread}
							canSend={!send.isPending && !block}
							findQuery={findOpen ? findQuery : ""}
							findActiveIndex={findActiveIndex}
						/>
					)}
				</div>
				{block ? <ChatBlockedBanner block={block} /> : null}
				<ChatInput
					ref={inputRef}
					threadId={activeThreadId}
					onSend={(body) => send.mutate(body)}
					onStop={STREAMING_ENABLED ? streamMessage.stop : undefined}
					canStop={STREAMING_ENABLED}
					isSending={send.isPending}
					disabledReason={block?.placeholder ?? null}
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
			<EditOlderConfirmDialog
				open={editConfirm !== null}
				onCancel={() => setEditConfirm(null)}
				onConfirm={confirmEdit}
			/>
			<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
			{isAdmin ? (
				<PersonaSheet
					open={personaSheetOpen}
					onOpenChange={setPersonaSheetOpen}
				/>
			) : null}
		</>
	);
}

function renderThreadMarkdown(t: Thread): string {
	const title = t.title ?? "Conversation";
	const lines: string[] = [`# ${title}`, ""];
	for (const msg of t.messages) {
		const who = msg.role === "user" ? "You" : "Mentor";
		const when = formatFullTimestamp(msg.created_at);
		lines.push(`## ${who} — ${when}`, "", stripChatBody(msg.body), "");
	}
	return lines.join("\n");
}

type ChatBlock = {
	kind: "out_of_credits" | "paused";
	title: string;
	body: string;
	placeholder: string;
};

function useChatBlockState(me: MeResponse | undefined): ChatBlock | null {
	if (!me) return null;
	const resetDate = new Date(me.credits.resets_at);
	const dateLabel = resetDate.toLocaleDateString(undefined, {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	const shortDate = resetDate.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
	if (me.agent_state.hard_stopped) {
		return {
			kind: "paused",
			title: m.chat_paused_title(),
			body: m.chat_paused_body({ date: dateLabel }),
			placeholder: `${m.chat_paused_title()} — ${shortDate}`,
		};
	}
	if (!me.credits.unlimited && me.credits.remaining <= 0) {
		return {
			kind: "out_of_credits",
			title: m.chat_out_of_credits_title(),
			body: m.chat_out_of_credits_body({ date: dateLabel }),
			placeholder: `${m.chat_out_of_credits_title()} — ${shortDate}`,
		};
	}
	return null;
}

function ChatBlockedBanner({ block }: { block: ChatBlock }) {
	const Icon = block.kind === "paused" ? PauseCircle : AlertTriangle;
	return (
		<output
			aria-live="polite"
			className="block border-t border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 px-4 py-3 text-[var(--theme-danger)]"
		>
			<div className="flex items-start gap-2.5">
				<Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<div className="min-w-0 text-sm">
					<p className="m-0 font-semibold">{block.title}</p>
					<p className="m-0 text-[var(--theme-danger)]/90">{block.body}</p>
				</div>
			</div>
		</output>
	);
}

function EditOlderConfirmDialog({
	open,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next: boolean) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent>
				<DialogTitle>{m.chat_edit_confirm_title()}</DialogTitle>
				<DialogDescription>{m.chat_edit_confirm_body()}</DialogDescription>
				<DialogFooter>
					<button type="button" onClick={onCancel} className="btn-secondary">
						{m.common_cancel()}
					</button>
					<button type="button" onClick={onConfirm} className="btn-primary">
						{m.chat_edit_confirm_action()}
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function InThreadFind({
	messages,
	query,
	activeIndex,
	onQueryChange,
	onClose,
	onNext,
	onPrev,
}: {
	messages: Message[];
	query: string;
	activeIndex: number;
	onQueryChange: (q: string) => void;
	onClose: () => void;
	onNext: () => void;
	onPrev: () => void;
}) {
	const totalMatches = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return 0;
		let n = 0;
		for (const mm of messages) {
			n += countOccurrences(mm.body.toLowerCase(), q);
		}
		return n;
	}, [messages, query]);

	const wrappedIndex =
		totalMatches > 0
			? ((activeIndex % totalMatches) + totalMatches) % totalMatches
			: 0;

	return (
		<div className="flex items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 sm:px-5">
			<input
				ref={(el) => {
					el?.focus();
				}}
				type="search"
				value={query}
				onChange={(e) => onQueryChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						if (e.shiftKey) onPrev();
						else onNext();
					} else if (e.key === "Escape") {
						e.preventDefault();
						onClose();
					}
				}}
				placeholder={m.chat_in_thread_search_placeholder()}
				aria-label={m.chat_in_thread_search_aria()}
				className="flex-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-sm text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-accent-ring)]"
			/>
			<span className="shrink-0 text-xs tabular-nums text-[var(--theme-muted)]">
				{query.trim()
					? totalMatches > 0
						? m.chat_in_thread_match_count({
								current: String(wrappedIndex + 1),
								total: String(totalMatches),
							})
						: m.chat_in_thread_no_matches()
					: ""}
			</span>
			<button
				type="button"
				onClick={onPrev}
				disabled={totalMatches === 0}
				className="rounded p-1 text-[var(--theme-muted)] transition hover:text-[var(--theme-primary)] disabled:opacity-50"
				aria-label="Previous match"
			>
				↑
			</button>
			<button
				type="button"
				onClick={onNext}
				disabled={totalMatches === 0}
				className="rounded p-1 text-[var(--theme-muted)] transition hover:text-[var(--theme-primary)] disabled:opacity-50"
				aria-label="Next match"
			>
				↓
			</button>
			<button
				type="button"
				onClick={onClose}
				className="rounded p-1 text-[var(--theme-muted)] transition hover:text-[var(--theme-primary)]"
				aria-label="Close search"
			>
				×
			</button>
		</div>
	);
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let pos = haystack.indexOf(needle, 0);
	while (pos !== -1) {
		count++;
		pos = haystack.indexOf(needle, pos + needle.length);
	}
	return count;
}
