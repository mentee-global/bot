import {
	ArrowRight,
	Compass,
	GraduationCap,
	MapPin,
	Sparkles,
} from "lucide-react";
import type { ThreadSummary } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

interface ChatWelcomeProps {
	userName: string;
	recentThreads?: ThreadSummary[];
	onPickStarter: (prompt: string) => void;
	onContinue?: (threadId: string) => void;
	disabled?: boolean;
}

export function ChatWelcome({
	userName,
	recentThreads = [],
	onPickStarter,
	onContinue,
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
		</div>
	);
}
