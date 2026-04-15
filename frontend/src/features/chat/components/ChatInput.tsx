import { SendHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

interface ChatInputProps {
	onSend: (body: string) => void;
	isSending: boolean;
}

export function ChatInput({ onSend, isSending }: ChatInputProps) {
	const [text, setText] = useState("");

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const trimmed = text.trim();
		if (!trimmed || isSending) return;
		onSend(trimmed);
		setText("");
	};

	const disabled = isSending || text.trim().length === 0;

	return (
		<form
			onSubmit={handleSubmit}
			className="flex w-full items-center gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3"
		>
			<input
				type="text"
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={
					isSending
						? m.chat_input_placeholder_waiting()
						: m.chat_input_placeholder()
				}
				disabled={isSending}
				className="flex-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3.5 py-2 text-sm text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none transition focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-accent-ring)] disabled:opacity-60"
			/>
			<button
				type="submit"
				disabled={disabled}
				aria-label={m.chat_send_aria()}
				className={cn(
					"flex h-9 w-9 items-center justify-center rounded-lg border transition",
					disabled
						? "cursor-not-allowed border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-muted)]"
						: "border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent)] hover:bg-[var(--theme-accent-hover)] hover:border-[var(--theme-accent-hover)] hover:-translate-y-0.5",
				)}
			>
				<SendHorizontal size={16} />
			</button>
		</form>
	);
}
