import { Check, Copy, Pencil, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { stripChatBody } from "#/features/chat/components/MessageBody";
import type { Message } from "#/features/chat/data/chat.types";
import { track } from "#/lib/analytics";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

interface MessageActionsProps {
	message: Message;
	canRetry: boolean;
	canEdit: boolean;
	onRetry?: () => void;
	onEdit?: () => void;
}

export function MessageActions({
	message,
	canRetry,
	canEdit,
	onRetry,
	onEdit,
}: MessageActionsProps) {
	const isUser = message.role === "user";
	const [copied, setCopied] = useState(false);

	if (message.streaming) return null;

	const handleCopy = async () => {
		const text = isUser ? message.body : stripChatBody(message.body);
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			toast.success(m.chat_copied_toast());
			track("chat.message_copied", { role: message.role });
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error(m.chat_copy_failed_toast());
		}
	};

	return (
		<div
			className={cn(
				"mt-1 flex items-center gap-0.5 text-[var(--theme-muted)] transition",
				"opacity-0 focus-within:opacity-100 group-hover/message:opacity-100",
				"[@media(hover:none)]:opacity-100",
				isUser ? "self-end" : "self-start",
			)}
		>
			<ActionButton onClick={handleCopy} label={m.chat_copy_message_aria()}>
				{copied ? (
					<Check aria-hidden="true" className="size-3.5" />
				) : (
					<Copy aria-hidden="true" className="size-3.5" />
				)}
			</ActionButton>
			{canEdit && onEdit ? (
				<ActionButton onClick={onEdit} label={m.chat_edit_message_aria()}>
					<Pencil aria-hidden="true" className="size-3.5" />
				</ActionButton>
			) : null}
			{canRetry && onRetry ? (
				<ActionButton onClick={onRetry} label={m.chat_retry_aria()}>
					<RotateCw aria-hidden="true" className="size-3.5" />
				</ActionButton>
			) : null}
		</div>
	);
}

function ActionButton({
	onClick,
	label,
	children,
}: {
	onClick: () => void;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="inline-flex size-6 items-center justify-center rounded transition hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)] focus-visible:bg-[var(--theme-surface)] focus-visible:text-[var(--theme-primary)]"
		>
			{children}
		</button>
	);
}
