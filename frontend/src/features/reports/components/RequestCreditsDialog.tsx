import { type FormEvent, useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/Dialog";
import { useSubmitCreditRequestMutation } from "#/features/reports/hooks/useReports";
import { m } from "#/paraglide/messages";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function RequestCreditsDialog({ open, onOpenChange }: Props) {
	const [reason, setReason] = useState("");
	const [amount, setAmount] = useState("");
	const [success, setSuccess] = useState(false);
	const submit = useSubmitCreditRequestMutation();

	// Reset state when the dialog closes so the next open is clean.
	// `submit` is intentionally NOT in the dep list: react-query returns a
	// new mutation-result reference each render, so depending on it makes
	// this effect fire every render, call `reset()`, update mutation state,
	// and loop forever. `reset` itself is bound to a stable mutation manager.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!open) {
			setReason("");
			setAmount("");
			setSuccess(false);
			submit.reset();
		}
	}, [open]);

	const canSubmit = reason.trim().length > 0 && !submit.isPending;

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		const parsed = amount.trim() ? Number.parseInt(amount, 10) : null;
		submit.mutate(
			{
				reason: reason.trim(),
				requested_amount:
					parsed !== null && Number.isFinite(parsed) && parsed > 0
						? parsed
						: undefined,
			},
			{
				onSuccess: () => setSuccess(true),
			},
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="bg-[var(--theme-bg)] text-[var(--theme-primary)] sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{m.request_credits_dialog_title()}</DialogTitle>
					<DialogDescription className="text-[var(--theme-secondary)]">
						{success
							? m.request_credits_success_body()
							: m.request_credits_dialog_description()}
					</DialogDescription>
				</DialogHeader>

				{success ? (
					<DialogFooter>
						<button
							type="button"
							className="btn-primary"
							onClick={() => onOpenChange(false)}
						>
							{m.request_credits_cancel()}
						</button>
					</DialogFooter>
				) : (
					<form onSubmit={handleSubmit} className="flex flex-col gap-3">
						<label className="flex flex-col gap-1.5 text-sm">
							<span className="font-medium">
								{m.request_credits_field_reason()}
							</span>
							<textarea
								required
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder={m.request_credits_field_reason_placeholder()}
								rows={4}
								className="resize-vertical rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
							/>
						</label>

						<label className="flex flex-col gap-1.5 text-sm">
							<span className="font-medium">
								{m.request_credits_field_amount()}
							</span>
							<input
								type="number"
								min={1}
								max={100000}
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
							/>
						</label>

						{submit.isError ? (
							<p className="text-sm text-[var(--theme-danger)]">
								{m.request_credits_error()}
							</p>
						) : null}

						<DialogFooter>
							<button
								type="button"
								className="btn-secondary"
								onClick={() => onOpenChange(false)}
								disabled={submit.isPending}
							>
								{m.request_credits_cancel()}
							</button>
							<button
								type="submit"
								className="btn-primary"
								disabled={!canSubmit}
							>
								{submit.isPending
									? m.request_credits_submitting()
									: m.request_credits_submit()}
							</button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
