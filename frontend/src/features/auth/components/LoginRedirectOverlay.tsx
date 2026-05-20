import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { authService } from "#/features/auth/data/auth.service";
import { clearLoginAttempt } from "#/features/auth/data/loginAttempt";
import { m } from "#/paraglide/messages";

const STEP_INTERVAL_MS = 900;
const STILL_WORKING_AFTER_MS = 30_000;
const FAILED_AFTER_MS = 60_000;

type Phase = "cycling" | "still_working" | "failed";

export function LoginRedirectOverlay() {
	const steps = [
		m.login_redirect_step_contacting(),
		m.login_redirect_step_checking(),
		m.login_redirect_step_finishing(),
	];
	const [stepIndex, setStepIndex] = useState(0);
	const [phase, setPhase] = useState<Phase>("cycling");

	useEffect(() => {
		const stepTimer = window.setInterval(() => {
			setStepIndex((i) => Math.min(i + 1, steps.length - 1));
		}, STEP_INTERVAL_MS);
		const stillTimer = window.setTimeout(
			() => setPhase((p) => (p === "cycling" ? "still_working" : p)),
			STILL_WORKING_AFTER_MS,
		);
		const failTimer = window.setTimeout(
			() => setPhase("failed"),
			FAILED_AFTER_MS,
		);
		return () => {
			window.clearInterval(stepTimer);
			window.clearTimeout(stillTimer);
			window.clearTimeout(failTimer);
		};
	}, [steps.length]);

	const handleRetry = () => {
		clearLoginAttempt();
		authService.startLogin({ roleHint: "mentee" });
	};

	return (
		<output
			aria-live="polite"
			aria-busy={phase !== "failed"}
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--theme-bg)]/85 px-4 backdrop-blur-sm animate-in fade-in duration-200"
		>
			<div className="surface-card rise-in flex w-full max-w-sm flex-col items-center gap-4 px-6 py-8 text-center shadow-xl">
				{phase !== "failed" ? (
					<>
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
								{phase === "still_working"
									? m.login_redirect_still_working()
									: steps[stepIndex]}
							</p>
						</div>
						<p className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-xs text-[var(--theme-muted)]">
							{m.login_redirect_warning()}
						</p>
					</>
				) : (
					<>
						<div className="flex flex-col gap-1">
							<h2 className="display-title text-lg font-semibold text-[var(--theme-primary)]">
								{m.login_redirect_failed_title()}
							</h2>
							<p className="text-sm text-[var(--theme-secondary)]">
								{m.login_redirect_failed_body()}
							</p>
						</div>
						<Button type="button" onClick={handleRetry} className="w-full">
							{m.login_redirect_retry_cta()}
						</Button>
					</>
				)}
			</div>
		</output>
	);
}
