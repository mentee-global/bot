import { Coins } from "lucide-react";
import { useState } from "react";
import { RequestCreditsDialog } from "#/features/reports/components/RequestCreditsDialog";
import { m } from "#/paraglide/messages";

/** "Request more credits" CTA — rendered inside ChatBlockedBanner when the
 * user has hit their quota. Opens RequestCreditsDialog. */
export function RequestCreditsButton() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--theme-danger)] bg-[var(--theme-bg)] px-3 py-1.5 text-sm font-medium text-[var(--theme-danger)] transition hover:bg-[var(--theme-danger)] hover:text-white"
			>
				<Coins className="size-3.5" aria-hidden="true" />
				{m.chat_request_more_credits_cta()}
			</button>
			<RequestCreditsDialog open={open} onOpenChange={setOpen} />
		</>
	);
}
