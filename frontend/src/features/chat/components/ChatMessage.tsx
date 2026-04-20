import { MessageBody } from "#/features/chat/components/MessageBody";
import { ToolChipRow } from "#/features/chat/components/ToolChip";
import { TypingIndicator } from "#/features/chat/components/TypingIndicator";
import type { Message } from "#/features/chat/data/chat.types";
import { useToolActivityForMessage } from "#/features/chat/hooks/useToolActivity";
import { cn } from "#/lib/utils";

interface ChatMessageProps {
	message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
	const isUser = message.role === "user";
	const tools = useToolActivityForMessage(isUser ? undefined : message.id);
	const hasText = message.body.length > 0;

	return (
		<div
			className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
		>
			<div
				className={cn(
					"max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
					isUser
						? "bg-[var(--theme-primary)] text-[var(--theme-bg)]"
						: "border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-primary)]",
				)}
			>
				{isUser ? (
					<p className="m-0 whitespace-pre-wrap leading-relaxed">
						{message.body}
					</p>
				) : hasText ? (
					<MessageBody body={message.body} streaming={message.streaming} />
				) : tools.length > 0 ? (
					// Tool is running and no text yet — show just the activity chip
					// (no typing dots, no stacking).
					<ToolChipRow activities={tools} />
				) : message.streaming ? (
					<TypingIndicator />
				) : null}
			</div>
		</div>
	);
}
