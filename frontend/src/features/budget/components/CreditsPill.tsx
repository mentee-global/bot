import { AlertTriangle, Coins, Info, PauseCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMeQuery } from "#/features/budget/hooks/useBudget";
import { cn } from "#/lib/utils";

export function CreditsPill() {
	const me = useMeQuery();
	const [open, setOpen] = useState(false);

	// Escape closes the popover regardless of how it was opened (touch vs hover).
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	const data = me.data;
	if (!data) return null;
	if (data.credits.unlimited) return null;

	const { remaining, total, monthly_allocation, granted_extra, resets_at } =
		data.credits;
	// `total` is the period pool (starting + grants). When an admin has granted
	// extra credits this period, surface that as a separate line so users
	// don't read "434 credits each month" as a permanent bump. `granted_extra`
	// is the server-side authoritative bonus — frozen against mid-period
	// config edits, unlike a frontend `total - monthly_allocation` calc.
	const hasBonus = granted_extra > 0;
	const bonus = granted_extra;
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
					className="hidden items-center gap-1.5 rounded-full border border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--theme-danger)] sm:inline-flex"
					title="All chat is paused until the next reset."
				>
					<PauseCircle size={12} />
					Paused
				</span>
			) : perplexity_degraded ? (
				<span
					className="hidden items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-secondary)] sm:inline-flex"
					title="Real-time search temporarily disabled to stay within budget."
				>
					<AlertTriangle size={12} />
					Limited search
				</span>
			) : null}
			<span className="group/pill relative inline-flex">
				<button
					type="button"
					aria-label="How credits work"
					aria-expanded={open}
					onPointerEnter={(e) => {
						// Mouse hover only — touch pointers fire enter on tap which would
						// race the click handler. Touch users get the popover via click.
						if (e.pointerType === "mouse") setOpen(true);
					}}
					onPointerLeave={(e) => {
						if (e.pointerType === "mouse") setOpen(false);
					}}
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
					<span>
						{remaining}/{total}
						<span className="hidden sm:inline"> credits</span>
					</span>
					<Info
						size={11}
						aria-hidden="true"
						className="hidden opacity-60 transition group-hover:opacity-100 sm:inline"
					/>
				</button>
				{open ? (
					<>
						{/* Mobile-only backdrop: tap-anywhere to dismiss the bottom sheet. */}
						<button
							type="button"
							aria-label="Close credits info"
							onClick={() => setOpen(false)}
							className="fixed inset-0 z-40 cursor-default bg-black/30 sm:hidden"
						/>
						<div
							role="tooltip"
							className={cn(
								"z-50 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4 text-left shadow-lg",
								"fixed inset-x-3 bottom-3",
								"sm:pointer-events-none sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 sm:p-3",
							)}
						>
							<button
								type="button"
								aria-label="Close"
								onClick={() => setOpen(false)}
								className="absolute right-2 top-2 rounded-md p-1 text-[var(--theme-muted)] transition hover:text-[var(--theme-primary)] sm:hidden"
							>
								<X size={14} />
							</button>
							<p className="m-0 mb-1.5 pr-6 text-xs font-semibold text-[var(--theme-primary)] sm:pr-0">
								How credits work
							</p>
							<ul className="m-0 list-none space-y-1.5 p-0 text-xs leading-relaxed text-[var(--theme-muted)]">
								<li>
									You get{" "}
									<span className="font-semibold text-[var(--theme-primary)]">
										{monthly_allocation} credits
									</span>{" "}
									each month for chatting with the mentor.
								</li>
								{hasBonus ? (
									<li>
										The team granted you{" "}
										<span className="font-semibold text-[var(--theme-primary)]">
											{bonus} extra credits
										</span>{" "}
										this period. They're available until the next reset and
										don't carry over.
									</li>
								) : null}
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
					</>
				) : null}
			</span>
			<span
				className="hidden text-[11px] tabular-nums text-[var(--theme-muted)] sm:inline"
				title={`${resetsLabel} (${inDaysLabel})`}
			>
				Renews {resetsShort}
			</span>
		</div>
	);
}
