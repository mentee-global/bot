import { CircleStop, Paperclip, SendHorizontal, X } from "lucide-react";
import {
	type ChangeEvent,
	type FormEvent,
	forwardRef,
	type KeyboardEvent,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ALLOWED_UPLOAD_MIMES } from "#/features/chat/data/documents.types";
import { useDraft } from "#/features/chat/hooks/useDraftsStore";
import type { StagedAttachment } from "#/features/chat/hooks/useStagedAttachments";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const MAX_LEN = 4000;
const COUNTER_THRESHOLD = 0.8;
const MAX_ROWS_PX = 200;

interface ChatInputProps {
	threadId: string | null;
	/** Resolves false to keep the typed text (e.g. attachment upload failed),
	 * otherwise the composer clears on submit. */
	onSend: (body: string) => boolean | Promise<boolean>;
	onStop?: () => void;
	isSending: boolean;
	canStop?: boolean;
	/**
	 * When set, the input is fully disabled and the placeholder is replaced
	 * with this reason. Used when the user is out of credits or chat is
	 * paused globally — sending is impossible until the next reset.
	 */
	disabledReason?: string | null;
	/** Files staged in the composer (not yet sent). On send they move to the
	 * message bubble in the chat area. */
	attachments: StagedAttachment[];
	onAttachFiles: (files: FileList) => void;
	onRemoveAttachment: (localId: string) => void;
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
			attachments,
			onAttachFiles,
			onRemoveAttachment,
		},
		ref,
	) {
		const { value: draftValue, setDraft, clearDraft } = useDraft(threadId);
		const [text, setText] = useState(draftValue);
		const [isComposing, setIsComposing] = useState(false);
		const [isCoarsePointer, setIsCoarsePointer] = useState(false);
		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const fileInputRef = useRef<HTMLInputElement>(null);

		useImperativeHandle(ref, () => ({
			focus: () => textareaRef.current?.focus(),
		}));

		useEffect(() => {
			setText(draftValue);
		}, [draftValue]);

		// Auto-grow: reset to auto then pin to scrollHeight (clamped) so the
		// textarea hugs its content until the cap, then scrolls.
		// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every text change — `text` is the trigger, not read in the body.
		useLayoutEffect(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
		}, [text]);

		useEffect(() => {
			if (!isSending && !disabledReason) textareaRef.current?.focus();
		}, [isSending, disabledReason]);

		// On touch devices the on-screen keyboard's Enter has no Shift modifier,
		// so we can't distinguish "send" from "newline" via the key event. Treat
		// coarse-pointer devices as mobile: Enter inserts a newline; users send
		// by tapping the button.
		useEffect(() => {
			const mq = window.matchMedia("(pointer: coarse)");
			setIsCoarsePointer(mq.matches);
			const handler = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches);
			mq.addEventListener("change", handler);
			return () => mq.removeEventListener("change", handler);
		}, []);

		const isBlocked = disabledReason !== null && disabledReason !== "";

		const handleSubmit = async (e?: FormEvent) => {
			e?.preventDefault();
			if (isBlocked) return;
			const trimmed = text.trim();
			if (!trimmed || isSending) return;
			// Clear immediately (ChatGPT-style): the message + any file move to the
			// chat area. onSend resolves false only on failure → restore the text.
			setText("");
			clearDraft();
			const result = onSend(trimmed);
			const ok = result instanceof Promise ? await result : result;
			if (ok === false) {
				setText(trimmed);
				setDraft(trimmed);
			}
		};

		const handleChange = (next: string) => {
			setText(next);
			setDraft(next);
		};

		const canAttach = !isBlocked;
		const handleAttachClick = () => fileInputRef.current?.click();
		const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
			if (e.target.files && e.target.files.length > 0)
				onAttachFiles(e.target.files);
			e.target.value = ""; // allow re-selecting the same file
		};

		const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key !== "Enter") return;
			// IME safety — submitting while composing eats the pending character.
			if (isComposing || e.nativeEvent.isComposing) return;
			if (e.shiftKey) return; // Shift+Enter → newline
			if (isCoarsePointer) return; // Touch keyboards: Enter → newline
			e.preventDefault();
			void handleSubmit();
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
				: // Nudge the user that an attachment needs an accompanying question.
					attachments.length > 0 && trimmedLen === 0
					? m.chat_attachment_needs_question()
					: m.chat_input_placeholder();

		return (
			<form
				onSubmit={handleSubmit}
				className="border-t border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-3 sm:px-4"
			>
				<div className="mx-auto w-full max-w-3xl lg:max-w-4xl">
					{attachments.length > 0 ? (
						<ul className="mb-2 flex flex-wrap gap-2">
							{attachments.map((a) => (
								<li
									key={a.localId}
									className="flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-secondary)]"
								>
									<Paperclip size={12} />
									<span className="max-w-[12rem] truncate" title={a.filename}>
										{a.filename}
									</span>
									<span className="text-[var(--theme-muted)]">
										· {m.chat_attachment_status_staged()}
									</span>
									<button
										type="button"
										onClick={() => onRemoveAttachment(a.localId)}
										aria-label={m.chat_attachment_remove_aria()}
										className="ml-0.5 rounded text-[var(--theme-muted)] hover:text-[var(--theme-primary)]"
									>
										<X size={12} />
									</button>
								</li>
							))}
						</ul>
					) : null}
					<input
						ref={fileInputRef}
						type="file"
						accept={ALLOWED_UPLOAD_MIMES.join(",")}
						multiple
						onChange={handleFileChange}
						className="hidden"
						tabIndex={-1}
					/>
					<div className="flex w-full items-center gap-2">
						<button
							type="button"
							onClick={handleAttachClick}
							disabled={!canAttach}
							aria-label={m.chat_attach_aria()}
							title={m.chat_attach_aria()}
							className={cn(
								"flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg border transition",
								canAttach
									? "border-[var(--theme-border)] text-[var(--theme-secondary)] hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)]"
									: "cursor-not-allowed border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-muted)]",
							)}
						>
							<Paperclip size={16} />
						</button>
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
								"block w-full flex-1 resize-none rounded-lg border bg-[var(--theme-bg)] px-3.5 py-2 text-base leading-6 text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none transition md:text-sm",
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
				</div>
			</form>
		);
	},
);
