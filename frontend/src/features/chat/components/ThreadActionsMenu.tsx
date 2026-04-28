import { ClipboardCopy, Download, MoreHorizontal } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { m } from "#/paraglide/messages";

interface ThreadActionsMenuProps {
	onExport?: () => void;
	onCopy?: () => void;
}

export function ThreadActionsMenu({
	onExport,
	onCopy,
}: ThreadActionsMenuProps) {
	if (!onExport && !onCopy) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Conversation actions"
					className="inline-flex size-8 items-center justify-center rounded-md text-[var(--theme-muted)] transition hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)]"
				>
					<MoreHorizontal aria-hidden="true" className="size-4" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-56">
				{onCopy ? (
					<DropdownMenuItem onSelect={onCopy}>
						<ClipboardCopy aria-hidden="true" className="size-4" />
						<span>{m.chat_copy_thread()}</span>
					</DropdownMenuItem>
				) : null}
				{onExport ? (
					<DropdownMenuItem onSelect={onExport}>
						<Download aria-hidden="true" className="size-4" />
						<span>{m.chat_export_thread()}</span>
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
