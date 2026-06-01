import { Link } from "@tanstack/react-router";
import { FileUser } from "lucide-react";
import ParaglideLocaleSwitcher from "#/components/LocaleSwitcher";
import { MenteeLogo } from "#/components/Logo";
import ThemeToggle from "#/components/ThemeToggle";
import { useSession } from "#/features/auth/hooks/useSession";
import { BugReportTrigger } from "#/features/reports/components/BugReportTrigger";
import { m } from "#/paraglide/messages";

export default function Header() {
	const session = useSession();
	return (
		<header className="sticky top-0 z-50 border-b border-[var(--theme-border)] bg-[var(--theme-header-bg)] px-4 backdrop-blur-xl sm:px-6">
			<div className="page-wrap flex h-16 items-center justify-between gap-4">
				<Link
					to="/"
					className="flex items-center gap-3 text-[var(--theme-primary)] transition-opacity hover:opacity-80"
				>
					<MenteeLogo className="h-7 w-7" />
					<span
						className="hidden sm:flex sm:items-baseline sm:gap-1.5"
						lang="en"
					>
						<span className="font-display text-lg font-semibold tracking-[0.18em] text-[var(--theme-primary)]">
							MENTEE
						</span>
						<span className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--theme-muted)]">
							Bot
						</span>
					</span>
				</Link>

				<div className="flex items-center gap-1.5">
					{session.data ? (
						<Link
							to="/profile"
							aria-label={m.profile_nav_link()}
							title={m.profile_nav_link()}
							className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 text-xs font-medium text-[var(--theme-primary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-elevated)]"
						>
							<FileUser size={14} strokeWidth={2} aria-hidden="true" />
							<span className="hidden sm:inline">{m.profile_nav_link()}</span>
						</Link>
					) : null}
					<BugReportTrigger user={session.data ?? null} variant="header" />
					<ParaglideLocaleSwitcher />
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
