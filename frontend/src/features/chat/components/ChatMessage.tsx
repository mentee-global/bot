import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageActions } from "#/features/chat/components/MessageActions";
import { MessageBody } from "#/features/chat/components/MessageBody";
import { ToolChipRow } from "#/features/chat/components/ToolChip";
import { TypingIndicator } from "#/features/chat/components/TypingIndicator";
import type { Message } from "#/features/chat/data/chat.types";
import { useToolActivityForMessage } from "#/features/chat/hooks/useToolActivity";
import { formatFullTimestamp, formatTime } from "#/lib/datetime";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

interface ChatMessageProps {
	message: Message;
	showTimestamp: boolean;
	isLastAssistant: boolean;
	canRetry?: boolean;
	canEdit?: boolean;
	onRetry?: () => void;
	onEdit?: (newBody: string) => void;
	onRetrySend?: () => void;
}

export function ChatMessage({
	message,
	showTimestamp,
	isLastAssistant,
	canRetry = false,
	canEdit = false,
	onRetry,
	onEdit,
	onRetrySend,
}: ChatMessageProps) {
	const isUser = message.role === "user";
	const tools = useToolActivityForMessage(isUser ? undefined : message.id);
	const hasText = message.body.length > 0;
	const hasError = !!message.error;
	const ariaLive =
		!isUser && isLastAssistant && message.streaming ? "polite" : undefined;

	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.body);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!editing) setDraft(message.body);
	}, [message.body, editing]);

	useEffect(() => {
		if (editing) {
			const el = textareaRef.current;
			if (el) {
				el.focus();
				el.setSelectionRange(el.value.length, el.value.length);
			}
		}
	}, [editing]);

	const startEdit = () => {
		setDraft(message.body);
		setEditing(true);
	};

	const cancelEdit = () => {
		setEditing(false);
		setDraft(message.body);
	};

	const submitEdit = () => {
		const trimmed = draft.trim();
		if (!trimmed || trimmed === message.body.trim()) {
			cancelEdit();
			return;
		}
		setEditing(false);
		onEdit?.(trimmed);
	};

	if (editing && isUser) {
		return (
			<div className="group/message flex w-full flex-col items-end">
				<div className="w-full max-w-[88%] rounded-2xl border border-[var(--theme-accent)] bg-[var(--theme-surface)] p-2 sm:max-w-[80%]">
					<textarea
						ref={textareaRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								cancelEdit();
							} else if (
								e.key === "Enter" &&
								!e.shiftKey &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								submitEdit();
							}
						}}
						rows={Math.min(8, Math.max(2, draft.split("\n").length))}
						className="w-full resize-none rounded-md bg-transparent p-1.5 text-sm leading-relaxed text-[var(--theme-primary)] outline-none"
					/>
					<div className="mt-1.5 flex items-center justify-end gap-2 text-xs">
						<button
							type="button"
							onClick={cancelEdit}
							className="rounded px-2 py-1 text-[var(--theme-muted)] transition hover:text-[var(--theme-primary)]"
						>
							{m.common_cancel()}
						</button>
						<button
							type="button"
							onClick={submitEdit}
							disabled={!draft.trim()}
							className={cn(
								"rounded-md border px-2.5 py-1 font-medium transition",
								draft.trim()
									? "border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent)] hover:bg-[var(--theme-accent-hover)]"
									: "cursor-not-allowed border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-muted)]",
							)}
						>
							{m.chat_edit_save_aria()}
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			data-chat-message="1"
			className={cn(
				"group/message flex w-full flex-col",
				isUser ? "items-end" : "items-start",
			)}
		>
			<div
				className={cn(
					"max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[80%] sm:px-4",
					isUser
						? hasError
							? "border border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 text-[var(--theme-primary)]"
							: "bg-[var(--theme-primary)] text-[var(--theme-bg)]"
						: "border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-primary)]",
				)}
				title={formatFullTimestamp(message.created_at)}
				aria-live={ariaLive}
				aria-busy={message.streaming || undefined}
			>
				{isUser ? (
					<p className="m-0 whitespace-pre-wrap leading-relaxed">
						{message.body}
					</p>
				) : hasText ? (
					<MessageBody body={message.body} streaming={message.streaming} />
				) : tools.length > 0 ? (
					<ToolChipRow activities={tools} />
				) : message.streaming ? (
					<TypingIndicator />
				) : null}
			</div>
			{hasError ? (
				<button
					type="button"
					onClick={onRetrySend}
					className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--theme-danger)] transition hover:underline"
				>
					<AlertTriangle aria-hidden="true" className="size-3" />
					<span>
						{m.chat_failed_send_label()} — {m.chat_failed_send_retry()}
					</span>
				</button>
			) : null}
			{showTimestamp ? (
				<time
					dateTime={message.created_at}
					className={cn(
						"mt-1 text-[10px] text-[var(--theme-muted)] tabular-nums",
						isUser ? "pr-1" : "pl-1",
					)}
				>
					{formatTime(message.created_at)}
				</time>
			) : null}
			<MessageActions
				message={message}
				canRetry={canRetry}
				canEdit={canEdit}
				onRetry={onRetry}
				onEdit={canEdit ? startEdit : undefined}
			/>
		</div>
	);
}
