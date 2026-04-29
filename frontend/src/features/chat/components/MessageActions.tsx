import {
	Check,
	Copy,
	Pencil,
	RotateCw,
	ThumbsDown,
	ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { stripChatBody } from "#/features/chat/components/MessageBody";
import type { Message } from "#/features/chat/data/chat.types";
import { useSubmitMessageRatingMutation } from "#/features/chat/hooks/useFeedback";
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
	const ratingMutation = useSubmitMessageRatingMutation();

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

	const currentRating = message.rating ?? null;

	const submitRating = (next: 1 | -1) => {
		// Toggle: clicking the active thumb clears it; clicking the other swaps.
		const rating: -1 | 0 | 1 = currentRating === next ? 0 : next;
		ratingMutation.mutate({
			messageId: message.id,
			threadId: message.thread_id,
			rating,
			priorRating: currentRating,
		});
	};

	return (
		<div
			className={cn(
				"mt-1 flex items-center gap-0.5 text-[var(--theme-muted)] transition",
				isUser ? "self-end" : "self-start",
			)}
		>
			{!isUser ? (
				<>
					<ActionButton
						onClick={() => submitRating(1)}
						label={m.chat_thumbs_up_aria()}
						active={currentRating === 1}
					>
						<ThumbsUp
							aria-hidden="true"
							className="size-3.5"
							fill={currentRating === 1 ? "currentColor" : "none"}
						/>
					</ActionButton>
					<ActionButton
						onClick={() => submitRating(-1)}
						label={m.chat_thumbs_down_aria()}
						active={currentRating === -1}
					>
						<ThumbsDown
							aria-hidden="true"
							className="size-3.5"
							fill={currentRating === -1 ? "currentColor" : "none"}
						/>
					</ActionButton>
				</>
			) : null}
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
	active,
	children,
}: {
	onClick: () => void;
	label: string;
	active?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			aria-pressed={active}
			title={label}
			className={cn(
				"inline-flex size-6 items-center justify-center rounded transition hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)] focus-visible:bg-[var(--theme-surface)] focus-visible:text-[var(--theme-primary)]",
				active && "text-[var(--theme-primary)]",
			)}
		>
			{children}
		</button>
	);
}
