import { CircleStop, SendHorizontal } from "lucide-react";
import {
	type FormEvent,
	forwardRef,
	type KeyboardEvent,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useDraft } from "#/features/chat/hooks/useDraftsStore";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const MAX_LEN = 4000;
const COUNTER_THRESHOLD = 0.8;
const MAX_ROWS_PX = 200;

interface ChatInputProps {
	threadId: string | null;
	onSend: (body: string) => void;
	onStop?: () => void;
	isSending: boolean;
	canStop?: boolean;
	/**
	 * When set, the input is fully disabled and the placeholder is replaced
	 * with this reason. Used when the user is out of credits or chat is
	 * paused globally — sending is impossible until the next reset.
	 */
	disabledReason?: string | null;
}

export interface ChatInputHandle {
	focus: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
	function ChatInput(
		{
			threadId,
			onSend,
			onStop,
			isSending,
			canStop = false,
			disabledReason = null,
		},
		ref,
	) {
		const { value: draftValue, setDraft, clearDraft } = useDraft(threadId);
		const [text, setText] = useState(draftValue);
		const [isComposing, setIsComposing] = useState(false);
		const textareaRef = useRef<HTMLTextAreaElement>(null);

		useImperativeHandle(ref, () => ({
			focus: () => textareaRef.current?.focus(),
		}));

		useEffect(() => {
			setText(draftValue);
		}, [draftValue]);

		// Auto-grow: reset to auto then pin to scrollHeight (clamped) so the
		// textarea hugs its content until the cap, then scrolls.
		useLayoutEffect(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
		}, [text]);

		useEffect(() => {
			if (!isSending && !disabledReason) textareaRef.current?.focus();
		}, [isSending, disabledReason]);

		const isBlocked = disabledReason !== null && disabledReason !== "";

		const handleSubmit = (e?: FormEvent) => {
			e?.preventDefault();
			if (isBlocked) return;
			const trimmed = text.trim();
			if (!trimmed || isSending) return;
			onSend(trimmed);
			setText("");
			clearDraft();
		};

		const handleChange = (next: string) => {
			setText(next);
			setDraft(next);
		};

		const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key !== "Enter") return;
			// IME safety — submitting while composing eats the pending character.
			if (isComposing || e.nativeEvent.isComposing) return;
			if (e.shiftKey) return; // Shift+Enter → newline
			e.preventDefault();
			handleSubmit();
		};

		const isStopMode = isSending && canStop && !isBlocked;
		const trimmedLen = text.trim().length;
		const canSubmit =
			trimmedLen > 0 && !isSending && !isBlocked && trimmedLen <= MAX_LEN;
		const overLimit = text.length > MAX_LEN;
		const showCounter =
			!isBlocked && text.length >= Math.floor(MAX_LEN * COUNTER_THRESHOLD);
		const placeholder = isBlocked
			? (disabledReason ?? m.chat_input_placeholder_blocked())
			: isSending
				? m.chat_input_placeholder_waiting()
				: m.chat_input_placeholder();

		return (
			<form
				onSubmit={handleSubmit}
				className="border-t border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-3 sm:px-4"
			>
				<div className="flex w-full items-center gap-2">
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => handleChange(e.target.value)}
						onKeyDown={handleKeyDown}
						onCompositionStart={() => setIsComposing(true)}
						onCompositionEnd={() => setIsComposing(false)}
						placeholder={placeholder}
						rows={1}
						maxLength={MAX_LEN + 200}
						spellCheck
						disabled={isBlocked}
						aria-disabled={isBlocked || undefined}
						data-gramm="false"
						data-gramm_editor="false"
						data-enable-grammarly="false"
						className={cn(
							"block w-full flex-1 resize-none rounded-lg border bg-[var(--theme-bg)] px-3.5 py-2 text-sm leading-6 text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none transition",
							isBlocked && "cursor-not-allowed opacity-60",
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
	},
);
