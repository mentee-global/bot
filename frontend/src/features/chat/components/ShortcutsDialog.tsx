import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/Dialog";
import { isModKeyLabel } from "#/lib/useShortcut";
import { m } from "#/paraglide/messages";

interface ShortcutsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
	const mod = isModKeyLabel();

	const rows: Array<{ label: string; combo: string[] }> = [
		{ label: m.chat_shortcut_new_chat(), combo: [mod, "K"] },
		{ label: m.chat_shortcut_focus_input(), combo: [mod, "/"] },
		{ label: m.chat_shortcut_search_thread(), combo: [mod, "F"] },
		{ label: m.chat_shortcut_show_help(), combo: ["?"] },
	];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogTitle>{m.chat_shortcuts_title()}</DialogTitle>
				<DialogDescription className="sr-only">
					{m.chat_shortcuts_title()}
				</DialogDescription>
				<ul className="m-0 mt-4 flex flex-col gap-2 p-0">
					{rows.map((row) => (
						<li
							key={row.label}
							className="flex list-none items-center justify-between gap-3 rounded-md bg-[var(--theme-surface)] px-3 py-2 text-sm"
						>
							<span className="text-[var(--theme-primary)]">{row.label}</span>
							<span className="flex items-center gap-1">
								{row.combo.map((k, i) => (
									<kbd
										// biome-ignore lint/suspicious/noArrayIndexKey: stable, ordered list
										key={i}
										className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--theme-secondary)]"
									>
										{k}
									</kbd>
								))}
							</span>
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
