import {
	ArrowRight,
	Compass,
	GraduationCap,
	MapPin,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ThreadSummary } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const WELCOME_TIPS_DISMISSED_KEY = "mentee:welcome-tips-dismissed";

export function clearWelcomeTipsState() {
	try {
		window.sessionStorage.removeItem(WELCOME_TIPS_DISMISSED_KEY);
	} catch {
		/* sessionStorage unavailable */
	}
}

interface ChatWelcomeProps {
	userName: string;
	recentThreads?: ThreadSummary[];
	onPickStarter: (prompt: string) => void;
	onContinue?: (threadId: string) => void;
	onOpenAbout?: () => void;
	disabled?: boolean;
}

export function ChatWelcome({
	userName,
	recentThreads = [],
	onPickStarter,
	onContinue,
	onOpenAbout,
	disabled = false,
}: ChatWelcomeProps) {
	const firstName = userName.split(" ")[0] ?? userName;
	const starters = [
		{
			icon: GraduationCap,
			label: m.chat_starter_scholarships(),
			prompt: m.chat_starter_scholarships(),
		},
		{
			icon: MapPin,
			label: m.chat_starter_study_abroad(),
			prompt: m.chat_starter_study_abroad(),
		},
		{
			icon: Compass,
			label: m.chat_starter_career(),
			prompt: m.chat_starter_career(),
		},
		{
			icon: Sparkles,
			label: m.chat_starter_visa(),
			prompt: m.chat_starter_visa(),
		},
	];

	const continuables = recentThreads
		.filter((t) => t.title && t.title.trim().length > 0)
		.slice(0, 2);

	return (
		<div className="mx-auto flex h-full max-w-2xl flex-col justify-center py-4">
			<p className="island-kicker mb-2">Hi {firstName}</p>
			<h2 className="display-title mb-2 text-2xl font-semibold text-[var(--theme-primary)] sm:text-3xl">
				{m.chat_welcome_title()}
			</h2>
			<p className="mb-6 text-sm text-[var(--theme-secondary)] sm:text-base">
				{m.chat_welcome_subtitle()}
			</p>

			{continuables.length > 0 && onContinue ? (
				<div className="mb-4">
					<p className="island-kicker m-0 mb-2">{m.chat_continue_kicker()}</p>
					<div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
						{continuables.map((t) => (
							<button
								key={t.thread_id}
								type="button"
								onClick={() => onContinue(t.thread_id)}
								className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-left text-sm text-[var(--theme-primary)] transition hover:border-[var(--theme-accent)]"
							>
								<span className="min-w-0 flex-1 truncate">{t.title}</span>
								<ArrowRight
									aria-hidden="true"
									className="size-4 shrink-0 text-[var(--theme-muted)] transition group-hover:text-[var(--theme-accent)]"
								/>
							</button>
						))}
					</div>
				</div>
			) : null}

			<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
				{starters.map(({ icon: Icon, label, prompt }) => (
					<button
						key={label}
						type="button"
						onClick={() => onPickStarter(prompt)}
						disabled={disabled}
						aria-disabled={disabled || undefined}
						className={cn(
							"group flex items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-left text-sm text-[var(--theme-primary)] transition",
							disabled
								? "cursor-not-allowed opacity-50"
								: "hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface)]",
						)}
					>
						<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--theme-accent-soft)] text-[var(--theme-accent-hover)]">
							<Icon aria-hidden="true" className="size-4" />
						</span>
						<span className="leading-snug">{label}</span>
					</button>
				))}
			</div>

			<WelcomeTipsCard onOpenAbout={onOpenAbout} />
		</div>
	);
}

function WelcomeTipsCard({ onOpenAbout }: { onOpenAbout?: () => void }) {
	// Per-session: shown once per browser session/login. sessionStorage clears
	// when the tab closes, and `clearWelcomeTipsState()` clears it on logout —
	// so the next login (in a new tab or after sign-out) sees the card again.
	// Still reachable any time via the header info icon and sidebar row.
	// Hidden on the server and on the first client paint to avoid a flash.
	const [hydrated, setHydrated] = useState(false);
	const [dismissed, setDismissed] = useState(true);

	useEffect(() => {
		let alreadySeen = false;
		try {
			alreadySeen =
				window.sessionStorage.getItem(WELCOME_TIPS_DISMISSED_KEY) === "1";
			// One-time cleanup of the old localStorage flag from the previous
			// per-device implementation, so it doesn't keep occupying space.
			window.localStorage.removeItem(WELCOME_TIPS_DISMISSED_KEY);
		} catch {
			alreadySeen = false;
		}
		if (!alreadySeen) {
			// Mark as seen for this session so reloads / new-chat navigations
			// during the same session don't reopen the card.
			try {
				window.sessionStorage.setItem(WELCOME_TIPS_DISMISSED_KEY, "1");
			} catch {
				/* sessionStorage unavailable — accept render-only behavior */
			}
		}
		setDismissed(alreadySeen);
		setHydrated(true);
	}, []);

	if (!hydrated || dismissed) return null;

	const handleDismiss = () => {
		setDismissed(true);
	};

	const tips = [
		m.welcome_tips_files(),
		m.welcome_tips_memory(),
		m.welcome_tips_credits(),
	];

	return (
		<aside className="relative mt-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 pr-9">
			<button
				type="button"
				onClick={handleDismiss}
				aria-label={m.welcome_tips_dismiss_aria()}
				className="absolute right-2 top-2 rounded-md p-1 text-[var(--theme-muted)] transition hover:bg-[var(--theme-bg)] hover:text-[var(--theme-primary)]"
			>
				<X aria-hidden="true" className="size-3.5" />
			</button>
			<p className="island-kicker m-0 mb-1.5">{m.welcome_tips_kicker()}</p>
			<ul className="m-0 flex flex-col gap-1 p-0">
				{tips.map((tip) => (
					<li
						key={tip}
						className="flex list-none items-start gap-2 text-xs text-[var(--theme-secondary)] sm:text-sm"
					>
						<span
							aria-hidden="true"
							className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--theme-muted)]"
						/>
						<span className="min-w-0 leading-snug">{tip}</span>
					</li>
				))}
			</ul>
			{onOpenAbout ? (
				<button
					type="button"
					onClick={onOpenAbout}
					className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--theme-accent-hover)] underline-offset-4 transition hover:underline sm:text-sm"
				>
					{m.welcome_tips_more()}
					<ArrowRight aria-hidden="true" className="size-3.5" />
				</button>
			) : null}
		</aside>
	);
}
