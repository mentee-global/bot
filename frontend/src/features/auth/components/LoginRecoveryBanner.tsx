import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { authService } from "#/features/auth/data/auth.service";
import {
	clearLoginAttempt,
	readLoginAttempt,
} from "#/features/auth/data/loginAttempt";
import { useSession } from "#/features/auth/hooks/useSession";
import { m } from "#/paraglide/messages";

const MIN_AGE_MS = 30_000;
const MAX_AGE_MS = 5 * 60_000;

/**
 * Recovery banner shown on the landing page when the user's last
 * Login-with-Mentee attempt didn't complete. Detected via the
 * `mentee_login_attempt` cookie set by `/api/auth/login`; the cookie is
 * deleted by every `/api/auth/callback` exit path, so a present-and-aged
 * cookie + no session means the user got bounced before reaching us.
 */
export function LoginRecoveryBanner() {
	const session = useSession();
	const [dismissed, setDismissed] = useState(false);
	// Defer reading the cookie until after hydration so SSR + CSR match.
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
	}, []);

	if (dismissed || now === null) return null;
	if (session.isLoading || session.data) return null;

	const attemptSec = readLoginAttempt();
	if (attemptSec === null) return null;
	const ageMs = now - attemptSec * 1000;
	if (ageMs < MIN_AGE_MS || ageMs > MAX_AGE_MS) return null;

	const handleRetry = () => {
		clearLoginAttempt();
		authService.startLogin({ roleHint: "mentee" });
	};
	const handleDismiss = () => {
		clearLoginAttempt();
		setDismissed(true);
	};

	return (
		<div
			role="alert"
			className="mb-6 flex flex-wrap items-start gap-3 rounded-md border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-4 py-3 text-sm"
		>
			<AlertCircle className="size-5 shrink-0 text-[var(--theme-accent)]" />
			<div className="min-w-0 flex-1">
				<p className="m-0 font-semibold text-[var(--theme-primary)]">
					{m.login_recovery_banner_title()}
				</p>
				<p className="mt-1 mb-0 text-[var(--theme-secondary)]">
					{m.login_recovery_banner_body()}
				</p>
			</div>
			<div className="flex shrink-0 gap-2">
				<Button type="button" size="sm" onClick={handleRetry}>
					{m.login_recovery_banner_retry()}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={handleDismiss}>
					{m.login_recovery_banner_dismiss()}
				</Button>
			</div>
		</div>
	);
}
