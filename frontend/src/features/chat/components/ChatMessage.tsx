import { ToolChipRow } from "#/features/chat/components/ToolChip";
import type { Message } from "#/features/chat/data/chat.types";
import { useToolActivityForMessage } from "#/features/chat/hooks/useToolActivity";
import { cn } from "#/lib/utils";

interface ChatMessageProps {
	message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
	const isUser = message.role === "user";
	const tools = useToolActivityForMessage(isUser ? undefined : message.id);

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
				{!isUser && tools.length > 0 ? (
					<ToolChipRow activities={tools} />
				) : null}
				<p className="m-0 whitespace-pre-wrap leading-relaxed">
					{message.body}
					{message.streaming ? (
						<span
							aria-hidden="true"
							className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-baseline"
						/>
					) : null}
				</p>
			</div>
		</div>
	);
}
