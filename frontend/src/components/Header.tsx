import { Link } from "@tanstack/react-router";
import ParaglideLocaleSwitcher from "#/components/LocaleSwitcher";
import { MenteeLogo } from "#/components/Logo";
import ThemeToggle from "#/components/ThemeToggle";
import { m } from "#/paraglide/messages";

export default function Header() {
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

				<nav
					className="hidden items-center gap-6 md:flex"
					aria-label={m.nav_main_aria()}
				>
					<Link
						to="/"
						className="nav-link text-[13px]"
						activeProps={{ className: "nav-link is-active text-[13px]" }}
					>
						{m.nav_home()}
					</Link>
					<Link
						to="/about"
						className="nav-link text-[13px]"
						activeProps={{ className: "nav-link is-active text-[13px]" }}
					>
						{m.nav_about()}
					</Link>
				</nav>

				<div className="flex items-center gap-1.5">
					<ParaglideLocaleSwitcher />
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
