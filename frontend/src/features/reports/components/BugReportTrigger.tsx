import { Bug } from "lucide-react";
import { useState } from "react";
import type { User } from "#/features/auth/data/auth.types";
import { BugReportDialog } from "#/features/reports/components/BugReportDialog";
import { m } from "#/paraglide/messages";

type Variant = "icon" | "link" | "header";

type Props = {
	/** Authenticated user, if any. Pass null on anonymous surfaces. */
	user: User | null;
	variant?: Variant;
	className?: string;
};

/** Opens BugReportDialog. Three variants matching where it's mounted:
 * - `header`: pill-button matching LocaleSwitcher / ThemeToggle in the global Header
 * - `icon`: compact icon button for tight chrome
 * - `link`: muted text link for in-flow placement */
export function BugReportTrigger({ user, variant = "link", className }: Props) {
	const [open, setOpen] = useState(false);

	const baseClasses =
		variant === "header"
			? "flex h-9 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 text-xs font-medium text-[var(--theme-primary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-elevated)]"
			: variant === "icon"
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
				) : variant === "header" ? (
					<>
						<Bug size={14} strokeWidth={2} aria-hidden="true" />
						<span className="hidden sm:inline">{m.report_bug_trigger()}</span>
					</>
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
