import type { Message } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";

interface ChatMessageProps {
	message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
	const isUser = message.role === "user";
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
				<p className="m-0 whitespace-pre-wrap leading-relaxed">
					{message.body}
				</p>
			</div>
		</div>
	);
}
