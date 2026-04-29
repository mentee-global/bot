import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/ui/Dialog";
import { InfoTooltip } from "#/components/ui/info-tooltip";
import { Input } from "#/components/ui/input";
import { StatItem } from "#/features/admin/components/shared";
import { UserPicker } from "#/features/admin/components/UserPicker";
import { Field } from "#/features/budget/components/Field";
import type { UserUsageResponse } from "#/features/budget/data/budget.types";
import {
	useGrantCreditsMutation,
	useResetQuotaMutation,
	useRevokeCreditsMutation,
	useSetOverrideMutation,
	useTransferCreditsMutation,
} from "#/features/budget/hooks/useBudget";
import { formatDate, formatMicros } from "#/features/budget/lib/format";

type DialogKind = "grant" | "revoke" | "transfer" | "override" | null;

export function UserQuotaCard({ data }: { data: UserUsageResponse }) {
	const [open, setOpen] = useState<DialogKind>(null);
	const reset = useResetQuotaMutation();
	const grant = useGrantCreditsMutation();
	const revoke = useRevokeCreditsMutation();
	const { quota } = data;

	return (
		<>
			<Card>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h3 className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Credits
							<InfoTooltip title="Billing period">
								<p className="m-0">
									Each user has their own monthly billing window, anchored to
									their first message or the last admin reset — not the calendar
									month.
								</p>
								<p className="m-0 mt-2">
									"This period" totals roll over on that user-specific
									anniversary. Lifetime totals below survive every reset.
								</p>
							</InfoTooltip>
						</h3>
						<div className="flex flex-wrap gap-2">
							<Button size="sm" onClick={() => setOpen("grant")}>
								Grant
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setOpen("revoke")}
							>
								Revoke
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setOpen("transfer")}
							>
								Transfer
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setOpen("override")}
							>
								{quota.override_monthly_credits == null
									? "Set monthly cap"
									: "Edit monthly cap"}
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={reset.isPending}
								onClick={() => reset.mutate(data.user_id)}
							>
								{reset.isPending ? "Resetting…" : "Reset month"}
							</Button>
						</div>
					</div>

					<dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<StatItem label="Remaining" value={quota.credits_remaining} />
						<StatItem
							label={
								<TooltipLabel
									label="Used this period"
									tip="Credits deducted from this user's balance during the current billing window. Resets to 0 on the user's monthly anniversary."
								/>
							}
							value={quota.credits_used_period}
						/>
						<StatItem
							label={
								<TooltipLabel
									label="Allotted this period"
									tip="Total credits made available this period — the monthly cap plus any admin grants or transfers in. Overwritten by the monthly cap on each reset."
								/>
							}
							value={quota.credits_granted_period}
						/>
						<StatItem
							label={
								<TooltipLabel
									label="Monthly cap"
									tip="Credits the user receives at every monthly reset. Set per-user via Override; otherwise the platform default from Budget → Config."
								/>
							}
							value={
								<span className="inline-flex items-baseline gap-1">
									<span>{quota.effective_monthly_credits}</span>
									<span className="text-[10px] font-normal text-muted-foreground">
										{quota.override_monthly_credits == null
											? "(default)"
											: "(override)"}
									</span>
								</span>
							}
						/>
						<StatItem
							label="Spend this period"
							value={formatMicros(quota.cost_period_micros, {
								precision: "auto",
							})}
						/>
						<StatItem
							label="Period started"
							value={formatDate(quota.period_start)}
						/>
					</dl>

					<div className="border-t pt-3">
						<h4 className="m-0 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							Lifetime
							<InfoTooltip title="Lifetime totals">
								<p className="m-0">
									Aggregated across the user's entire history — not reset on
									the monthly rollover. Useful for spotting heavy users or
									estimating total cost-to-serve.
								</p>
							</InfoTooltip>
						</h4>
						<dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
							<StatItem
								label={
									<TooltipLabel
										label="Turns"
										tip="Total turns this user has had with the mentor across all periods. A turn that called multiple providers still counts once."
									/>
								}
								value={quota.turns_total.toLocaleString()}
							/>
							<StatItem
								label={
									<TooltipLabel
										label="Credits used"
										tip="Total credits ever charged to this user. Survives monthly resets."
									/>
								}
								value={quota.credits_used_total.toLocaleString()}
							/>
							<StatItem
								label={
									<TooltipLabel
										label="Total spend"
										tip="Sum of provider costs (USD) we estimate this user has incurred across their full history. Pricing is captured at write-time, so historical rates aren't rewritten by a config change."
									/>
								}
								value={formatMicros(quota.cost_total_micros, {
									precision: "auto",
								})}
							/>
							<StatItem
								label={
									<TooltipLabel
										label="Tokens (in / out)"
										tip="Sum of input / output tokens across every provider call. web_search rows always contribute 0 (the OpenAI builtin doesn't expose token counts)."
									/>
								}
								value={
									<span className="tabular-nums">
										{quota.input_tokens_total.toLocaleString()}
										<span className="mx-1 text-muted-foreground">/</span>
										{quota.output_tokens_total.toLocaleString()}
									</span>
								}
							/>
						</dl>
					</div>
				</CardContent>
			</Card>

			{open === "grant" ? (
				<AmountDialog
					title="Grant credits"
					description={`Add credits to ${data.user_id}. They'll be available immediately.`}
					confirmLabel="Grant"
					mutation={grant}
					buildPayload={(amount, reason) => ({
						userId: data.user_id,
						amount,
						reason,
					})}
					onClose={() => setOpen(null)}
				/>
			) : null}

			{open === "revoke" ? (
				<AmountDialog
					title="Revoke credits"
					description="Remove credits from the current balance. Clamps to zero; won't go negative."
					confirmLabel="Revoke"
					mutation={revoke}
					buildPayload={(amount, reason) => ({
						userId: data.user_id,
						amount,
						reason,
					})}
					onClose={() => setOpen(null)}
				/>
			) : null}

			{open === "transfer" ? (
				<TransferDialog
					fromUserId={data.user_id}
					maxAmount={quota.credits_remaining}
					onClose={() => setOpen(null)}
				/>
			) : null}

			{open === "override" ? (
				<OverrideDialog
					userId={data.user_id}
					initial={quota.override_monthly_credits}
					onClose={() => setOpen(null)}
				/>
			) : null}
		</>
	);
}

function AmountDialog<
	M extends {
		isPending: boolean;
		mutateAsync: (payload: {
			userId: string;
			amount: number;
			reason?: string;
		}) => Promise<unknown>;
		reset: () => void;
	},
>({
	title,
	description,
	confirmLabel,
	mutation,
	buildPayload,
	onClose,
}: {
	title: string;
	description: string;
	confirmLabel: string;
	mutation: M;
	buildPayload: (
		amount: number,
		reason: string,
	) => { userId: string; amount: number; reason?: string };
	onClose: () => void;
}) {
	const [amount, setAmount] = useState(10);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setError(null);
		if (amount < 1) return setError("Amount must be at least 1.");
		try {
			await mutation.mutateAsync(buildPayload(amount, reason));
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Request failed");
		}
	};

	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
			<DialogContent>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
				<div className="flex flex-col gap-3">
					<Field label="Amount">
						<Input
							type="number"
							min={1}
							value={amount}
							onChange={(e) =>
								setAmount(Math.max(1, Number.parseInt(e.target.value, 10) || 0))
							}
						/>
					</Field>
					<Field label="Reason (optional)">
						<Input
							type="text"
							maxLength={200}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. compensate for failed turns"
						/>
					</Field>
					{error ? (
						<p className="m-0 text-xs text-destructive">{error}</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={onClose}
						disabled={mutation.isPending}
					>
						Cancel
					</Button>
					<Button onClick={submit} disabled={mutation.isPending}>
						{mutation.isPending ? "Saving…" : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TransferDialog({
	fromUserId,
	maxAmount,
	onClose,
}: {
	fromUserId: string;
	maxAmount: number;
	onClose: () => void;
}) {
	const transfer = useTransferCreditsMutation();
	const [targetId, setTargetId] = useState<string | null>(null);
	const [amount, setAmount] = useState(1);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setError(null);
		if (!targetId) return setError("Pick a destination user.");
		if (targetId === fromUserId)
			return setError("Source and destination must be different users.");
		if (amount < 1) return setError("Amount must be at least 1.");
		if (amount > maxAmount)
			return setError(`Source has only ${maxAmount} credits.`);
		try {
			await transfer.mutateAsync({
				fromUserId,
				toUserId: targetId,
				amount,
				reason,
			});
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Transfer failed");
		}
	};

	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
			<DialogContent>
				<DialogTitle>Transfer credits</DialogTitle>
				<DialogDescription>
					Move credits from this user to another. Source must have enough
					remaining.
				</DialogDescription>
				<div className="flex flex-col gap-3">
					<Field
						label="Destination user"
						hint="Search by name or email — no need to know the user ID."
					>
						<UserPicker
							value={targetId}
							onChange={(id) => setTargetId(id)}
							excludeUserId={fromUserId}
							placeholder="Search by name or email…"
						/>
					</Field>
					<Field label={`Amount (source has ${maxAmount})`}>
						<Input
							type="number"
							min={1}
							max={maxAmount || undefined}
							value={amount}
							onChange={(e) =>
								setAmount(Math.max(1, Number.parseInt(e.target.value, 10) || 0))
							}
						/>
					</Field>
					<Field label="Reason (optional)">
						<Input
							type="text"
							maxLength={200}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</Field>
					{error ? (
						<p className="m-0 text-xs text-destructive">{error}</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={onClose}
						disabled={transfer.isPending}
					>
						Cancel
					</Button>
					<Button onClick={submit} disabled={transfer.isPending}>
						{transfer.isPending ? "Transferring…" : "Transfer"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function OverrideDialog({
	userId,
	initial,
	onClose,
}: {
	userId: string;
	initial: number | null;
	onClose: () => void;
}) {
	const set = useSetOverrideMutation();
	const [value, setValue] = useState<string>(
		initial == null ? "" : String(initial),
	);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setError(null);
		const parsed = value.trim() === "" ? null : Number.parseInt(value, 10);
		if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
			return setError("Enter a non-negative integer, or leave blank to clear.");
		}
		try {
			await set.mutateAsync({ userId, amount: parsed });
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed");
		}
	};

	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
			<DialogContent>
				<DialogTitle>Monthly credit cap</DialogTitle>
				<DialogDescription>
					Override the default credits-per-month for this user. Applied on every
					monthly reset. Leave blank to clear the override.
				</DialogDescription>
				<div className="flex flex-col gap-3">
					<Field label="Credits per month">
						<Input
							type="number"
							min={0}
							value={value}
							placeholder="blank = default"
							onChange={(e) => setValue(e.target.value)}
						/>
					</Field>
					{error ? (
						<p className="m-0 text-xs text-destructive">{error}</p>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={set.isPending}>
						Cancel
					</Button>
					<Button onClick={submit} disabled={set.isPending}>
						{set.isPending ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TooltipLabel({ label, tip }: { label: string; tip: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1">
			{label}
			<InfoTooltip title={label}>{tip}</InfoTooltip>
		</span>
	);
}
