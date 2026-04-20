import { MessageSquarePlus, Pencil, Search, Trash2 } from "lucide-react";
import type { ThreadSummary } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { ThreadListSkeleton } from "#/features/chat/components/ChatSkeletons";

interface ThreadSidebarProps {
	threads: ThreadSummary[];
	activeThreadId: string | null;
	isLoading: boolean;
	query: string;
	onQueryChange: (value: string) => void;
	onSelect: (threadId: string) => void;
	onCreate: () => void;
	onRequestRename: (thread: ThreadSummary) => void;
	onRequestDelete: (thread: ThreadSummary) => void;
	isCreating: boolean;
}

export function ThreadSidebar({
	threads,
	activeThreadId,
	isLoading,
	query,
	onQueryChange,
	onSelect,
	onCreate,
	onRequestRename,
	onRequestDelete,
	isCreating,
}: ThreadSidebarProps) {
	const trimmedQuery = query.trim();
	const showNoResults =
		!isLoading && threads.length === 0 && trimmedQuery.length > 0;
	const showEmpty =
		!isLoading && threads.length === 0 && trimmedQuery.length === 0;

	return (
		<aside className="flex w-64 shrink-0 flex-col border-r border-[var(--theme-border)] bg-[var(--theme-surface)]">
			<div className="flex items-center justify-between gap-2 border-b border-[var(--theme-border)] px-3 py-3">
				<p className="island-kicker m-0">{m.chat_threads_heading()}</p>
				<button
					type="button"
					onClick={onCreate}
					disabled={isCreating}
					className={cn(
						"inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition",
						isCreating
							? "cursor-not-allowed border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)]"
							: "border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent)] hover:bg-[var(--theme-accent-hover)] hover:border-[var(--theme-accent-hover)]",
					)}
				>
					<MessageSquarePlus size={14} />
					{m.chat_new_thread()}
				</button>
			</div>
			<div className="px-3 py-2">
				<label className="relative block">
					<span className="sr-only">{m.chat_thread_search_placeholder()}</span>
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--theme-muted)]"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => onQueryChange(e.target.value)}
						placeholder={m.chat_thread_search_placeholder()}
						className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] py-1.5 pl-7 pr-2 text-xs text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none transition focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-accent-ring)]"
					/>
				</label>
			</div>
			<div className="flex-1 overflow-y-auto px-2 pb-2">
				{isLoading ? (
					<ThreadListSkeleton />
				) : showEmpty ? (
					<p className="px-2 py-4 text-center text-xs text-[var(--theme-muted)]">
						{m.chat_thread_empty_sidebar()}
					</p>
				) : showNoResults ? (
					<p className="px-2 py-4 text-center text-xs text-[var(--theme-muted)]">
						{m.chat_thread_search_no_results({ query: trimmedQuery })}
					</p>
				) : (
					<ul className="m-0 flex flex-col gap-1 p-0">
						{threads.map((t) => {
							const isActive = t.thread_id === activeThreadId;
							return (
								<li key={t.thread_id} className="group relative list-none">
									<button
										type="button"
										onClick={() => onSelect(t.thread_id)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2.5 py-2 pr-14 text-left text-sm transition",
											isActive
												? "bg-[var(--theme-primary)] text-[var(--theme-bg)]"
												: "text-[var(--theme-primary)] hover:bg-[var(--theme-bg)]",
										)}
									>
										<span className="flex-1 truncate">
											{t.title ?? m.chat_thread_untitled()}
										</span>
									</button>
									<div
										className={cn(
											"absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5",
											"opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100",
										)}
									>
										<IconButton
											label={m.chat_rename_thread_aria()}
											onClick={(e) => {
												e.stopPropagation();
												onRequestRename(t);
											}}
											active={isActive}
										>
											<Pencil size={13} />
										</IconButton>
										<IconButton
											label={m.chat_delete_thread_aria()}
											onClick={(e) => {
												e.stopPropagation();
												onRequestDelete(t);
											}}
											active={isActive}
										>
											<Trash2 size={13} />
										</IconButton>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</aside>
	);
}

// Single-action icon button used for the rename/delete affordances so the
// styling stays in sync between the two.
function IconButton({
	label,
	onClick,
	active,
	children,
}: {
	label: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
	active: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className={cn(
				"rounded p-1 transition",
				active
					? "text-[var(--theme-bg)] hover:bg-black/10"
					: "text-[var(--theme-muted)] hover:bg-[var(--theme-border)] hover:text-[var(--theme-primary)]",
			)}
		>
			{children}
		</button>
	);
}
