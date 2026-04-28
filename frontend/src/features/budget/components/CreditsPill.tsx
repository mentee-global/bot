import { AlertTriangle, Coins, Info, PauseCircle } from "lucide-react";
import { useState } from "react";
import { useMeQuery } from "#/features/budget/hooks/useBudget";
import { cn } from "#/lib/utils";

export function CreditsPill() {
	const me = useMeQuery();
	const [open, setOpen] = useState(false);
	const data = me.data;
	if (!data) return null;
	if (data.credits.unlimited) return null;

	const { remaining, total, resets_at } = data.credits;
	const { perplexity_degraded, hard_stopped } = data.agent_state;
	const pct = total > 0 ? (remaining / total) * 100 : 0;
	const low = pct <= 20;
	const empty = remaining <= 0;

	const resetDate = new Date(resets_at);
	const resetsShort = resetDate.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
	const resetsLabel = resetDate.toLocaleDateString(undefined, {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	const daysUntil = Math.max(
		0,
		Math.round((resetDate.getTime() - Date.now()) / 86_400_000),
	);
	const inDaysLabel =
		daysUntil === 0
			? "today"
			: daysUntil === 1
				? "tomorrow"
				: `in ${daysUntil} days`;

	return (
		<div className="flex items-center gap-2">
			{hard_stopped ? (
				<span
					className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--theme-danger)]"
					title="All chat is paused until the next reset."
				>
					<PauseCircle size={12} />
					Paused
				</span>
			) : perplexity_degraded ? (
				<span
					className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-secondary)]"
					title="Real-time search temporarily disabled to stay within budget."
				>
					<AlertTriangle size={12} />
					Limited search
				</span>
			) : null}
			<span className="relative inline-flex">
				<button
					type="button"
					aria-label="How credits work"
					aria-expanded={open}
					onMouseEnter={() => setOpen(true)}
					onMouseLeave={() => setOpen(false)}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onClick={(e) => {
						e.preventDefault();
						setOpen((v) => !v);
					}}
					className={cn(
						"group inline-flex cursor-help items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]",
						empty
							? "border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 text-[var(--theme-danger)] hover:bg-[var(--theme-danger)]/15"
							: low
								? "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-primary)] hover:border-[var(--theme-accent)]"
								: "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-secondary)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-primary)]",
					)}
				>
					<Coins size={12} />
					{remaining} / {total} credits
					<Info
						size={11}
						aria-hidden="true"
						className="opacity-60 transition group-hover:opacity-100"
					/>
				</button>
				{open ? (
					<div
						role="tooltip"
						className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3 text-left shadow-lg"
					>
						<p className="m-0 mb-1.5 text-xs font-semibold text-[var(--theme-primary)]">
							How credits work
						</p>
						<ul className="m-0 list-none space-y-1.5 p-0 text-xs leading-relaxed text-[var(--theme-muted)]">
							<li>
								You get{" "}
								<span className="font-semibold text-[var(--theme-primary)]">
									{total} credits
								</span>{" "}
								each month for chatting with the mentor.
							</li>
							<li>
								Every reply uses some credits. Quick answers cost a little;
								longer answers and live web research cost more.
							</li>
							<li>
								Your balance refreshes on{" "}
								<span className="font-semibold text-[var(--theme-primary)]">
									{resetsLabel}
								</span>{" "}
								<span className="text-[var(--theme-secondary)]">
									({inDaysLabel}).
								</span>
							</li>
							{hard_stopped ? (
								<li className="text-[var(--theme-danger)]">
									You've used this month's credits — chat resumes after the
									reset.
								</li>
							) : perplexity_degraded ? (
								<li>
									Real-time web search is paused this month so you can keep
									chatting; the mentor will rely on what it already knows.
								</li>
							) : null}
						</ul>
					</div>
				) : null}
			</span>
			<span
				className="text-[11px] tabular-nums text-[var(--theme-muted)]"
				title={`${resetsLabel} (${inDaysLabel})`}
			>
				Renews {resetsShort}
			</span>
		</div>
	);
}
