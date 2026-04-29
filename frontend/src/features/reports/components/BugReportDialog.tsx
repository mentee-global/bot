import { type FormEvent, useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/Dialog";
import type { User } from "#/features/auth/data/auth.types";
import { useSubmitBugReportMutation } from "#/features/reports/hooks/useReports";
import { m } from "#/paraglide/messages";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Authenticated user, if any. When null, email becomes a required field. */
	user: User | null;
};

export function BugReportDialog({ open, onOpenChange, user }: Props) {
	const [description, setDescription] = useState("");
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [success, setSuccess] = useState(false);
	const submit = useSubmitBugReportMutation();

	// Reset state when the dialog closes so the next open is clean.
	// `submit` is intentionally NOT in the dep list: react-query returns a new
	// mutation-result reference each render, so depending on it makes this
	// effect fire every render, call `reset()`, update mutation state, and
	// loop forever. `reset` itself is bound to a stable mutation manager.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!open) {
			setDescription("");
			setEmail("");
			setName("");
			setSuccess(false);
			submit.reset();
		}
	}, [open]);

	const isAnonymous = user === null;
	const canSubmit =
		description.trim().length > 0 &&
		(!isAnonymous || email.trim().length > 0) &&
		!submit.isPending;

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		submit.mutate(
			{
				description: description.trim(),
				page_url:
					typeof window !== "undefined" ? window.location.pathname : null,
				user_email: isAnonymous ? email.trim() : undefined,
				user_name: isAnonymous && name.trim() ? name.trim() : undefined,
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
					<DialogTitle>{m.report_bug_dialog_title()}</DialogTitle>
					<DialogDescription className="text-[var(--theme-secondary)]">
						{success
							? m.report_bug_success_body()
							: m.report_bug_dialog_description()}
					</DialogDescription>
				</DialogHeader>

				{success ? (
					<DialogFooter>
						<button
							type="button"
							className="btn-primary"
							onClick={() => onOpenChange(false)}
						>
							{m.report_bug_cancel()}
						</button>
					</DialogFooter>
				) : (
					<form onSubmit={handleSubmit} className="flex flex-col gap-3">
						<label className="flex flex-col gap-1.5 text-sm">
							<span className="font-medium">
								{m.report_bug_field_description()}
							</span>
							<textarea
								required
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder={m.report_bug_field_description_placeholder()}
								rows={4}
								className="resize-vertical rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
							/>
						</label>

						{isAnonymous ? (
							<>
								<label className="flex flex-col gap-1.5 text-sm">
									<span className="font-medium">
										{m.report_bug_field_email()}
									</span>
									<input
										required
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder={m.report_bug_field_email_placeholder()}
										className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
									/>
								</label>
								<label className="flex flex-col gap-1.5 text-sm">
									<span className="font-medium">
										{m.report_bug_field_name()}
									</span>
									<input
										type="text"
										value={name}
										onChange={(e) => setName(e.target.value)}
										className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
									/>
								</label>
							</>
						) : null}

						{submit.isError ? (
							<p className="text-sm text-[var(--theme-danger)]">
								{m.report_bug_error()}
							</p>
						) : null}

						<DialogFooter>
							<button
								type="button"
								className="btn-secondary"
								onClick={() => onOpenChange(false)}
								disabled={submit.isPending}
							>
								{m.report_bug_cancel()}
							</button>
							<button
								type="submit"
								className="btn-primary"
								disabled={!canSubmit}
							>
								{submit.isPending
									? m.report_bug_submitting()
									: m.report_bug_submit()}
							</button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
