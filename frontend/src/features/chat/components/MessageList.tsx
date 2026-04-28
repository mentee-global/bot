import { ArrowDown } from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ChatMessage } from "#/features/chat/components/ChatMessage";
import { DateDivider } from "#/features/chat/components/DateDivider";
import { ThreadActionsMenu } from "#/features/chat/components/ThreadActionsMenu";
import type { Message } from "#/features/chat/data/chat.types";
import { isCloseInTime, isSameDay } from "#/lib/datetime";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

interface MessageListProps {
	messages: Message[];
	isReplying: boolean;
	canSend?: boolean;
	onRetryLast?: () => void;
	onEditMessage?: (messageId: string, newBody: string) => void;
	onRetryFailed?: (message: Message) => void;
	onPickSuggestion?: (text: string) => void;
	onExportThread?: () => void;
	onCopyThread?: () => void;
	findQuery?: string;
	findActiveIndex?: number;
}

export function MessageList({
	messages,
	isReplying,
	canSend = true,
	onRetryLast,
	onEditMessage,
	onRetryFailed,
	onPickSuggestion,
	onExportThread,
	onCopyThread,
	findQuery = "",
	findActiveIndex = 0,
}: MessageListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const lastUserSendCountRef = useRef(0);
	const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

	const userMsgCount = useMemo(
		() => messages.filter((mm) => mm.role === "user").length,
		[messages],
	);

	const lastMessage = messages[messages.length - 1];
	const isLastStreaming =
		lastMessage?.role === "assistant" && lastMessage?.streaming === true;

	const lastAssistantId = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "assistant") return messages[i].id;
		}
		return null;
	}, [messages]);

	useEffect(() => {
		const sentinel = sentinelRef.current;
		const root = scrollRef.current;
		if (!sentinel || !root) return;
		const observer = new IntersectionObserver(
			([entry]) => setIsPinnedToBottom(entry.isIntersecting),
			{ root, threshold: 0, rootMargin: "0px 0px 80px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, []);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		sentinelRef.current?.scrollIntoView({ behavior, block: "end" });
	}, []);

	useEffect(() => {
		if (messages.length === 0) return;
		const userSentNew = userMsgCount > lastUserSendCountRef.current;
		lastUserSendCountRef.current = userMsgCount;
		if (userSentNew || isPinnedToBottom) {
			scrollToBottom(userSentNew ? "smooth" : "auto");
		}
	}, [messages, userMsgCount, isPinnedToBottom, scrollToBottom]);

	const trimmedFind = findQuery.trim();

	if (messages.length === 0 && !isReplying) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-center text-sm text-[var(--theme-muted)]">
				<p className="mb-1 font-semibold text-[var(--theme-secondary)]">
					Say hi to your mentor
				</p>
				<p className="max-w-sm">
					Ask about scholarships, target roles, or what to learn next.
				</p>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="relative flex flex-col gap-3">
			{onExportThread || onCopyThread ? (
				<div className="flex justify-end">
					<ThreadActionsMenu onExport={onExportThread} onCopy={onCopyThread} />
				</div>
			) : null}
			{messages.map((msg, idx) => {
				const prev = idx > 0 ? messages[idx - 1] : null;
				const showDivider =
					!prev || !isSameDay(prev.created_at, msg.created_at);
				const showTimestamp =
					!prev ||
					prev.role !== msg.role ||
					!isCloseInTime(prev.created_at, msg.created_at);

				const isLastAssistant = msg.id === lastAssistantId;
				const canRetryHere =
					!!onRetryLast && isLastAssistant && !msg.streaming && canSend;
				const canEditHere = !!onEditMessage && msg.role === "user" && canSend;

				return (
					<Fragment key={msg.id}>
						{showDivider ? <DateDivider iso={msg.created_at} /> : null}
						<ChatMessage
							message={msg}
							showTimestamp={showTimestamp}
							isLastAssistant={isLastAssistant}
							canRetry={canRetryHere}
							canEdit={canEditHere}
							onRetry={canRetryHere ? onRetryLast : undefined}
							onEdit={
								canEditHere
									? (newBody) => onEditMessage?.(msg.id, newBody)
									: undefined
							}
							onRetrySend={
								msg.error && onRetryFailed
									? () => onRetryFailed(msg)
									: undefined
							}
						/>
						{isLastAssistant &&
						!msg.streaming &&
						msg.suggestions &&
						msg.suggestions.length > 0 ? (
							<SuggestionRow
								suggestions={msg.suggestions}
								disabled={!canSend}
								onPick={(s) => onPickSuggestion?.(s)}
							/>
						) : null}
					</Fragment>
				);
			})}
			{isReplying && !isLastStreaming ? (
				<div className="text-xs italic text-[var(--theme-muted)]">
					Mentor is typing…
				</div>
			) : null}
			<div ref={sentinelRef} />
			{!isPinnedToBottom ? (
				<button
					type="button"
					onClick={() => scrollToBottom("smooth")}
					className="sticky bottom-3 ml-auto inline-flex items-center gap-1.5 self-end rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-1.5 text-xs font-medium text-[var(--theme-primary)] shadow-md transition hover:border-[var(--theme-accent)]"
				>
					<ArrowDown className="size-3.5" aria-hidden="true" />
					{m.chat_jump_to_latest()}
				</button>
			) : null}
			{trimmedFind ? (
				<FindHighlights query={trimmedFind} activeIndex={findActiveIndex} />
			) : null}
		</div>
	);
}

function SuggestionRow({
	suggestions,
	disabled,
	onPick,
}: {
	suggestions: string[];
	disabled: boolean;
	onPick: (s: string) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{suggestions.slice(0, 4).map((s) => (
				<button
					key={s}
					type="button"
					onClick={() => onPick(s)}
					disabled={disabled}
					className={cn(
						"rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-1 text-xs text-[var(--theme-secondary)] transition",
						disabled
							? "cursor-not-allowed opacity-60"
							: "hover:border-[var(--theme-accent)] hover:text-[var(--theme-primary)]",
					)}
				>
					{s}
				</button>
			))}
		</div>
	);
}

// Highlights matches in DOM after layout. Walks the message list root and
// wraps text occurrences with <mark> elements; cleans up on unmount/change.
function FindHighlights({
	query,
	activeIndex,
}: {
	query: string;
	activeIndex: number;
}) {
	useEffect(() => {
		if (!query) return;
		const root = document.querySelector<HTMLElement>(
			"[data-chat-message-root]",
		);
		const containers = document.querySelectorAll<HTMLElement>(
			"[data-chat-message]",
		);
		if (!root && containers.length === 0) return;

		const marks: HTMLElement[] = [];
		const lower = query.toLowerCase();

		for (const container of containers) {
			const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			let node = walker.nextNode();
			while (node) {
				if (node.parentElement?.closest("button,kbd,time")) {
					node = walker.nextNode();
					continue;
				}
				nodes.push(node as Text);
				node = walker.nextNode();
			}
			for (const text of nodes) {
				const value = text.nodeValue ?? "";
				const valueLower = value.toLowerCase();
				let lastEnd = 0;
				const frag = document.createDocumentFragment();
				let didMatch = false;
				let pos = valueLower.indexOf(lower, lastEnd);
				while (pos !== -1) {
					didMatch = true;
					if (pos > lastEnd) {
						frag.appendChild(
							document.createTextNode(value.slice(lastEnd, pos)),
						);
					}
					const mark = document.createElement("mark");
					mark.className =
						"rounded-sm bg-[var(--theme-accent)]/40 text-inherit";
					mark.dataset.findMark = "1";
					mark.textContent = value.slice(pos, pos + query.length);
					marks.push(mark);
					frag.appendChild(mark);
					lastEnd = pos + query.length;
					pos = valueLower.indexOf(lower, lastEnd);
				}
				if (didMatch) {
					if (lastEnd < value.length) {
						frag.appendChild(document.createTextNode(value.slice(lastEnd)));
					}
					text.parentNode?.replaceChild(frag, text);
				}
			}
		}

		if (marks.length > 0) {
			const idx = ((activeIndex % marks.length) + marks.length) % marks.length;
			const active = marks[idx];
			active.classList.add("ring-2", "ring-[var(--theme-accent)]");
			active.scrollIntoView({ behavior: "smooth", block: "center" });
		}

		return () => {
			for (const mark of marks) {
				const parent = mark.parentNode;
				if (!parent) continue;
				parent.replaceChild(
					document.createTextNode(mark.textContent ?? ""),
					mark,
				);
				parent.normalize();
			}
		};
	}, [query, activeIndex]);

	return null;
}
