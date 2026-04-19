import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { m } from "#/paraglide/messages";

const STEP_INTERVAL_MS = 900;

export function LoginRedirectOverlay() {
	const steps = [
		m.login_redirect_step_contacting(),
		m.login_redirect_step_checking(),
		m.login_redirect_step_finishing(),
	];
	const [stepIndex, setStepIndex] = useState(0);

	useEffect(() => {
		const id = window.setInterval(() => {
			setStepIndex((i) => Math.min(i + 1, steps.length - 1));
		}, STEP_INTERVAL_MS);
		return () => window.clearInterval(id);
	}, [steps.length]);

	return (
		<output
			aria-live="polite"
			aria-busy="true"
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--theme-bg)]/85 px-4 backdrop-blur-sm animate-in fade-in duration-200"
		>
			<div className="surface-card rise-in flex w-full max-w-sm flex-col items-center gap-4 px-6 py-8 text-center shadow-xl">
				<Loader2
					size={36}
					className="animate-spin text-[var(--theme-accent)]"
					aria-hidden="true"
				/>
				<div className="flex flex-col gap-1">
					<h2 className="display-title text-lg font-semibold text-[var(--theme-primary)]">
						{m.login_redirect_title()}
					</h2>
					<p className="min-h-5 text-sm text-[var(--theme-secondary)] transition-opacity duration-300">
						{steps[stepIndex]}
					</p>
				</div>
				<p className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-xs text-[var(--theme-muted)]">
					{m.login_redirect_warning()}
				</p>
			</div>
		</output>
	);
}
