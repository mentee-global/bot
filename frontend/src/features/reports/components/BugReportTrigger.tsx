import { Bug } from "lucide-react";
import { useState } from "react";
import type { User } from "#/features/auth/data/auth.types";
import { BugReportDialog } from "#/features/reports/components/BugReportDialog";
import { m } from "#/paraglide/messages";

type Variant = "icon" | "link";

type Props = {
	/** Authenticated user, if any. Pass null on anonymous surfaces (landing). */
	user: User | null;
	variant?: Variant;
	className?: string;
};

/** Single trigger component used in two places: the chat header (icon) and
 * the landing page footer (link). Opens BugReportDialog. */
export function BugReportTrigger({ user, variant = "link", className }: Props) {
	const [open, setOpen] = useState(false);

	const baseClasses =
		variant === "icon"
			? "inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--theme-border)] p-1.5 text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-primary)]"
			: "text-sm text-[var(--theme-muted)] underline-offset-4 transition hover:text-[var(--theme-primary)] hover:underline";

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className={[baseClasses, className].filter(Boolean).join(" ")}
				aria-label={m.report_bug_trigger()}
				title={m.report_bug_trigger()}
			>
				{variant === "icon" ? (
					<Bug className="size-4" aria-hidden="true" />
				) : (
					<>
						<Bug className="mr-1.5 inline size-3.5" aria-hidden="true" />
						{m.report_bug_trigger()}
					</>
				)}
			</button>
			<BugReportDialog open={open} onOpenChange={setOpen} user={user} />
		</>
	);
}
