import { CircleStop, SendHorizontal } from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const MAX_LEN = 4000;
const COUNTER_THRESHOLD = 0.8;
const MAX_ROWS_PX = 200;

interface ChatInputProps {
	onSend: (body: string) => void;
	onStop?: () => void;
	isSending: boolean;
	canStop?: boolean;
}

export function ChatInput({
	onSend,
	onStop,
	isSending,
	canStop = false,
}: ChatInputProps) {
	const [text, setText] = useState("");
	const [isComposing, setIsComposing] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Auto-grow: reset to auto then pin to scrollHeight (clamped) so the
	// textarea hugs its content until the cap, then scrolls.
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
	}, [text]);

	useEffect(() => {
		if (!isSending) textareaRef.current?.focus();
	}, [isSending]);

	const handleSubmit = (e?: FormEvent) => {
		e?.preventDefault();
		const trimmed = text.trim();
		if (!trimmed || isSending) return;
		onSend(trimmed);
		setText("");
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key !== "Enter") return;
		// IME safety — submitting while composing eats the pending character.
		if (isComposing || e.nativeEvent.isComposing) return;
		if (e.shiftKey) return; // Shift+Enter → newline
		e.preventDefault();
		handleSubmit();
	};

	const isStopMode = isSending && canStop;
	const trimmedLen = text.trim().length;
	const canSubmit = trimmedLen > 0 && !isSending && trimmedLen <= MAX_LEN;
	const overLimit = text.length > MAX_LEN;
	const showCounter = text.length >= Math.floor(MAX_LEN * COUNTER_THRESHOLD);

	return (
		<form
			onSubmit={handleSubmit}
			className="border-t border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3"
		>
			<div className="flex w-full items-center gap-2">
				<textarea
					ref={textareaRef}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={handleKeyDown}
					onCompositionStart={() => setIsComposing(true)}
					onCompositionEnd={() => setIsComposing(false)}
					placeholder={
						isSending
							? m.chat_input_placeholder_waiting()
							: m.chat_input_placeholder()
					}
					rows={1}
					maxLength={MAX_LEN + 200}
					spellCheck
					data-gramm="false"
					data-gramm_editor="false"
					data-enable-grammarly="false"
					className={cn(
						"block w-full flex-1 resize-none rounded-lg border bg-[var(--theme-bg)] px-3.5 py-2 text-sm leading-6 text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none transition",
						overLimit
							? "border-[var(--theme-danger)] focus:border-[var(--theme-danger)] focus:ring-2 focus:ring-[var(--theme-danger)]/25"
							: "border-[var(--theme-border)] focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-accent-ring)]",
					)}
					style={{ maxHeight: `${MAX_ROWS_PX}px` }}
				/>
				{isStopMode ? (
					<button
						type="button"
						onClick={onStop}
						aria-label={m.chat_stop_aria()}
						className={cn(
							"flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg border transition",
							"border-[var(--theme-danger)] bg-[var(--theme-danger)] text-white",
							"hover:brightness-110 focus-visible:outline-2 focus-visible:outline-[var(--theme-danger)]",
						)}
					>
						<CircleStop size={16} />
					</button>
				) : (
					<button
						type="submit"
						disabled={!canSubmit}
						aria-label={m.chat_send_aria()}
						className={cn(
							"flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg border transition",
							canSubmit
								? "border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent)] hover:-translate-y-0.5 hover:border-[var(--theme-accent-hover)] hover:bg-[var(--theme-accent-hover)]"
								: "cursor-not-allowed border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-muted)]",
						)}
					>
						<SendHorizontal size={16} />
					</button>
				)}
			</div>

			{showCounter ? (
				<div className="mt-1.5 flex justify-end px-1 text-[11px] text-[var(--theme-muted)]">
					<span
						className={cn(
							"tabular-nums",
							overLimit && "font-semibold text-[var(--theme-danger)]",
						)}
					>
						{text.length.toLocaleString()} / {MAX_LEN.toLocaleString()}
					</span>
				</div>
			) : null}
		</form>
	);
}
