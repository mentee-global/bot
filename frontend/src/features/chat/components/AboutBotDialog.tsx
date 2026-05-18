import { Coins, FileText, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/Dialog";
import { m } from "#/paraglide/messages";

interface AboutBotDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function AboutBotDialog({ open, onOpenChange }: AboutBotDialogProps) {
	const items: Array<{
		icon: typeof FileText;
		title: string;
		body: ReactNode;
	}> = [
		{
			icon: FileText,
			title: m.about_bot_files_title(),
			body: m.about_bot_files_body(),
		},
		{
			icon: MessageCircle,
			title: m.about_bot_memory_title(),
			body: (
				<>
					{m.about_bot_memory_body_before()}
					<a
						href="https://menteeglobal.org"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-[var(--theme-accent-hover)] underline underline-offset-2 hover:no-underline"
					>
						{m.about_bot_memory_link_text()}
					</a>
					{m.about_bot_memory_body_after()}
				</>
			),
		},
		{
			icon: Coins,
			title: m.about_bot_credits_title(),
			body: m.about_bot_credits_body(),
		},
	];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-3 p-5 sm:p-6">
				<DialogTitle className="pr-8">{m.about_bot_title()}</DialogTitle>
				<DialogDescription>{m.about_bot_subtitle()}</DialogDescription>
				<ul className="m-0 mt-1 flex flex-col gap-4 p-0">
					{items.map(({ icon: Icon, title, body }) => (
						<li key={title} className="flex list-none items-start gap-3">
							<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--theme-accent-soft)] text-[var(--theme-accent-hover)]">
								<Icon aria-hidden="true" className="size-3.5" />
							</span>
							<div className="min-w-0">
								<p className="m-0 text-sm font-medium text-[var(--theme-primary)]">
									{title}
								</p>
								<p className="m-0 mt-0.5 text-sm leading-snug text-[var(--theme-secondary)]">
									{body}
								</p>
							</div>
						</li>
					))}
				</ul>
				<div className="mt-1 flex justify-end">
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="btn-secondary"
					>
						{m.about_bot_close()}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
