import { useEffect, useRef } from "react";
import { ChatMessage } from "#/features/chat/components/ChatMessage";
import type { Message } from "#/features/chat/data/chat.types";

interface MessageListProps {
	messages: Message[];
	isReplying: boolean;
}

export function MessageList({ messages, isReplying }: MessageListProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (messages.length === 0) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [messages]);

	const lastMessage = messages[messages.length - 1];
	const isLastStreaming =
		lastMessage?.role === "assistant" && lastMessage?.streaming === true;

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
		<div className="flex flex-col gap-3">
			{messages.map((m) => (
				<ChatMessage key={m.id} message={m} />
			))}
			{isReplying && !isLastStreaming ? (
				<div className="text-xs italic text-[var(--theme-muted)]">
					Mentor is typing…
				</div>
			) : null}
			<div ref={bottomRef} />
		</div>
	);
}
