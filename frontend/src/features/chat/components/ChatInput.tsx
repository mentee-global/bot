import {
	CircleStop,
	Loader2,
	Paperclip,
	SendHorizontal,
	X,
} from "lucide-react";
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
import {
	ALLOWED_UPLOAD_MIMES,
	type DocumentStatus,
} from "#/features/chat/data/documents.types";
import { useDraft } from "#/features/chat/hooks/useDraftsStore";
import {
	type Attachment,
	useThreadAttachments,
} from "#/features/chat/hooks/useThreadAttachments";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

function attachmentStatusLabel(status: Attachment["status"]): string {
	switch (status) {
		case "uploading":
			return m.chat_attachment_status_uploading();
		case "pending":
		case "processing":
			return m.chat_attachment_status_processing();
		case "ready":
			return m.chat_attachment_status_ready();
		case "failed":
			return m.chat_attachment_status_failed();
	}
}

const NON_TERMINAL: ReadonlySet<DocumentStatus | "uploading"> = new Set([
	"uploading",
	"pending",
	"processing",
]);

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
		const [isCoarsePointer, setIsCoarsePointer] = useState(false);
		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const fileInputRef = useRef<HTMLInputElement>(null);
		const { attachments, addFiles, remove } = useThreadAttachments(threadId);

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

		// Attaching requires a thread; on a brand-new chat the thread is created
		// on first send, so the button stays disabled until then.
		const canAttach = !!threadId && !isBlocked;

		const handleAttachClick = () => fileInputRef.current?.click();

		const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
			if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
			e.target.value = ""; // allow re-selecting the same file
		};

		const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key !== "Enter") return;
			// IME safety — submitting while composing eats the pending character.
			if (isComposing || e.nativeEvent.isComposing) return;
			if (e.shiftKey) return; // Shift+Enter → newline
			if (isCoarsePointer) return; // Touch keyboards: Enter → newline
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
				<div className="mx-auto w-full max-w-3xl lg:max-w-4xl">
					{attachments.length > 0 ? (
						<ul className="mb-2 flex flex-wrap gap-2">
							{attachments.map((a) => (
								<li
									key={a.localId}
									className={cn(
										"flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
										a.status === "failed"
											? "border-[var(--theme-danger)] text-[var(--theme-danger)]"
											: "border-[var(--theme-border)] text-[var(--theme-secondary)]",
									)}
								>
									{NON_TERMINAL.has(a.status) ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<Paperclip size={12} />
									)}
									<span className="max-w-[12rem] truncate" title={a.filename}>
										{a.filename}
									</span>
									<span className="text-[var(--theme-muted)]">
										· {attachmentStatusLabel(a.status)}
									</span>
									<button
										type="button"
										onClick={() => remove(a.localId)}
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
							title={
								canAttach ? m.chat_attach_aria() : m.chat_attach_disabled_hint()
							}
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
