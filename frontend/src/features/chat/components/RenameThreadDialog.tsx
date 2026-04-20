import { type FormEvent, useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/ui/Dialog";
import type { ThreadSummary } from "#/features/chat/data/chat.types";
import { m } from "#/paraglide/messages";

interface RenameThreadDialogProps {
	thread: ThreadSummary | null;
	onCancel: () => void;
	onConfirm: (threadId: string, title: string) => void;
	isSaving: boolean;
}

export function RenameThreadDialog({
	thread,
	onCancel,
	onConfirm,
	isSaving,
}: RenameThreadDialogProps) {
	const open = thread !== null;
	const [value, setValue] = useState("");

	useEffect(() => {
		if (thread) setValue(thread.title ?? "");
	}, [thread]);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const trimmed = value.trim();
		if (!trimmed || !thread || isSaving) return;
		onConfirm(thread.thread_id, trimmed);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogTitle>{m.chat_rename_thread_title()}</DialogTitle>
					<DialogDescription>{m.chat_rename_thread_body()}</DialogDescription>
					<input
						// biome-ignore lint/a11y/noAutofocus: rename dialog benefits from immediate focus
						autoFocus
						type="text"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						maxLength={200}
						placeholder={m.chat_rename_thread_placeholder()}
						disabled={isSaving}
						className="mt-4 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3.5 py-2 text-sm text-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] outline-none transition focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-accent-ring)] disabled:opacity-60"
					/>
					<DialogFooter>
						<button
							type="button"
							onClick={onCancel}
							disabled={isSaving}
							className="btn-secondary"
						>
							{m.common_cancel()}
						</button>
						<button
							type="submit"
							disabled={isSaving || value.trim().length === 0}
							className="btn-primary"
						>
							{isSaving ? m.common_saving() : m.common_save()}
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
