import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/ui/Dialog";
import type { ThreadSummary } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

interface ConfirmDeleteThreadDialogProps {
	thread: ThreadSummary | null;
	onCancel: () => void;
	onConfirm: (threadId: string) => void;
	isDeleting: boolean;
}

export function ConfirmDeleteThreadDialog({
	thread,
	onCancel,
	onConfirm,
	isDeleting,
}: ConfirmDeleteThreadDialogProps) {
	const open = thread !== null;
	const title = thread?.title ?? m.chat_thread_untitled();

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent>
				<DialogTitle>{m.chat_delete_thread_title()}</DialogTitle>
				<DialogDescription>
					{m.chat_delete_thread_body({ title })}
				</DialogDescription>
				<DialogFooter>
					<button
						type="button"
						onClick={onCancel}
						disabled={isDeleting}
						className="btn-secondary"
					>
						{m.common_cancel()}
					</button>
					<button
						type="button"
						onClick={() => thread && onConfirm(thread.thread_id)}
						disabled={isDeleting}
						className={cn(
							"inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition",
							"border-[var(--theme-danger)] bg-[var(--theme-danger)] text-white",
							"hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
						)}
					>
						{isDeleting ? m.common_deleting() : m.chat_delete_thread_confirm()}
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
