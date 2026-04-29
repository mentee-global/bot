import { Link } from "@tanstack/react-router";
import ParaglideLocaleSwitcher from "#/components/LocaleSwitcher";
import { MenteeLogo } from "#/components/Logo";
import ThemeToggle from "#/components/ThemeToggle";
import { useSession } from "#/features/auth/hooks/useSession";
import { BugReportTrigger } from "#/features/reports/components/BugReportTrigger";

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
					<BugReportTrigger user={session.data ?? null} variant="header" />
					<ParaglideLocaleSwitcher />
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
