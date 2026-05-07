import {
	type Activity,
	Clock,
	Layers,
	MessageSquare,
	RotateCw,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Skeleton } from "#/components/ui/Skeleton";
import { ErrorState } from "#/features/admin/components/shared";
import type {
	FeedbackTriggerConfig,
	FeedbackTriggerMode,
	UpdateFeedbackTriggerConfigPayload,
} from "#/features/admin/data/admin.types";
import {
	useAdminTriggerConfigQuery,
	useUpdateTriggerConfigMutation,
} from "#/features/admin/hooks/useAdmin";
import { cn } from "#/lib/utils";

type DurationUnit = "minutes" | "hours" | "days";

const UNIT_TO_MINUTES: Record<DurationUnit, number> = {
	minutes: 1,
	hours: 60,
	days: 1440,
};

/** Pick the largest unit that the minute value cleanly divides into so the
 * form re-opens with the same shape the admin saved. Falls back to minutes
 * when there's a non-divisible remainder. */
function decodeDuration(minutes: number): {
	value: number;
	unit: DurationUnit;
} {
	if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
	if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
	return { value: minutes, unit: "minutes" };
}

function encodeDuration(value: number, unit: DurationUnit): number {
	return Math.max(1, Math.round(value * UNIT_TO_MINUTES[unit]));
}

interface FormState {
	enabled: boolean;
	mode: FeedbackTriggerMode;
	interactions_first: number;
	interactions_repeat: number;
	time_first_value: number;
	time_first_unit: DurationUnit;
	time_repeat_value: number;
	time_repeat_unit: DurationUnit;
	re_rate_after_messages: number;
}

function configToForm(config: FeedbackTriggerConfig): FormState {
	const first = decodeDuration(config.time_first_minutes);
	const repeat = decodeDuration(config.time_repeat_minutes);
	return {
		enabled: config.enabled,
		mode: config.mode,
		interactions_first: config.interactions_first,
		interactions_repeat: config.interactions_repeat,
		time_first_value: first.value,
		time_first_unit: first.unit,
		time_repeat_value: repeat.value,
		time_repeat_unit: repeat.unit,
		re_rate_after_messages: config.re_rate_after_messages,
	};
}

function formToPayload(form: FormState): UpdateFeedbackTriggerConfigPayload {
	return {
		enabled: form.enabled,
		mode: form.mode,
		interactions_first: form.interactions_first,
		interactions_repeat: form.interactions_repeat,
		time_first_minutes: encodeDuration(
			form.time_first_value,
			form.time_first_unit,
		),
		time_repeat_minutes: encodeDuration(
			form.time_repeat_value,
			form.time_repeat_unit,
		),
		re_rate_after_messages: form.re_rate_after_messages,
	};
}

/**
 * Admin form for the in-chat session rating prompt cadence. Fetches the
 * current config, lets the admin pick a trigger mode (interactions / time /
 * hybrid) and tune its parameters, and writes back via PUT. On success the
 * mutation hook also primes the user-facing query cache so chats in other
 * open tabs pick up the new cadence on their next read.
 */
export function TriggerConfigForm() {
	const query = useAdminTriggerConfigQuery();
	const update = useUpdateTriggerConfigMutation();

	const [form, setForm] = useState<FormState | null>(null);

	// Sync form state with whatever the server returned. Re-runs when the
	// query refetches so external edits (another admin) flow into the form.
	useEffect(() => {
		if (query.data) setForm(configToForm(query.data));
	}, [query.data]);

	if (query.isPending) {
		return <FormSkeleton />;
	}
	if (query.isError) {
		return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
	}
	if (!form) return null;

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		update.mutate(formToPayload(form), {
			onSuccess: () => toast.success("Feedback cadence updated"),
			onError: () => toast.error("Couldn't save the cadence"),
		});
	};

	const showInteractions =
		form.mode === "interactions" || form.mode === "hybrid";
	const showTime = form.mode === "time" || form.mode === "hybrid";

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<Card className="gap-3 py-4 sm:py-6">
				<CardHeader className="px-4 sm:px-6">
					<CardTitle className="text-base sm:text-lg">
						Rating prompt cadence
					</CardTitle>
					<p className="text-xs text-muted-foreground sm:text-sm">
						Controls when users see the in-chat star rating card. Changes
						propagate to live chats within a few minutes.
					</p>
				</CardHeader>
				<CardContent className="flex flex-col gap-5 px-4 sm:px-6">
					<EnabledToggle
						enabled={form.enabled}
						onChange={(enabled) => setForm({ ...form, enabled })}
					/>

					<fieldset
						disabled={!form.enabled}
						className={cn(
							"flex flex-col gap-5 transition-opacity",
							!form.enabled && "opacity-50",
						)}
					>
						<ModePicker
							mode={form.mode}
							onChange={(mode) => setForm({ ...form, mode })}
						/>

						{showInteractions ? (
							<InteractionsFields
								form={form}
								onChange={(patch) => setForm({ ...form, ...patch })}
							/>
						) : null}

						{showTime ? (
							<TimeFields
								form={form}
								onChange={(patch) => setForm({ ...form, ...patch })}
							/>
						) : null}

						<ReRateFields
							form={form}
							onChange={(patch) => setForm({ ...form, ...patch })}
						/>
					</fieldset>
				</CardContent>
			</Card>

			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={() => query.data && setForm(configToForm(query.data))}
					disabled={update.isPending}
				>
					Reset
				</Button>
				<Button type="submit" disabled={update.isPending}>
					{update.isPending ? "Saving…" : "Save changes"}
				</Button>
			</div>
		</form>
	);
}

function EnabledToggle({
	enabled,
	onChange,
}: {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--theme-border)] p-3 transition hover:border-[var(--theme-border-strong)]">
			<div className="flex flex-col">
				<span className="text-sm font-medium">Enabled</span>
				<span className="text-xs text-muted-foreground">
					Master switch — uncheck to stop showing the rating card to all users.
				</span>
			</div>
			<input
				type="checkbox"
				checked={enabled}
				onChange={(e) => onChange(e.target.checked)}
				className="size-4 cursor-pointer accent-[var(--theme-accent)]"
			/>
		</label>
	);
}

const MODE_OPTIONS: {
	value: FeedbackTriggerMode;
	label: string;
	description: string;
	icon: typeof Activity;
}[] = [
	{
		value: "interactions",
		label: "Interactions",
		description: "Ask after a number of user messages.",
		icon: MessageSquare,
	},
	{
		value: "time",
		label: "Time",
		description: "Ask after a fixed amount of time has passed.",
		icon: Clock,
	},
	{
		value: "hybrid",
		label: "Hybrid",
		description: "Whichever fires first — interactions or time.",
		icon: Layers,
	},
];

function ModePicker({
	mode,
	onChange,
}: {
	mode: FeedbackTriggerMode;
	onChange: (mode: FeedbackTriggerMode) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">Trigger mode</span>
			<div className="grid gap-2 sm:grid-cols-3">
				{MODE_OPTIONS.map((opt) => {
					const Icon = opt.icon;
					const active = mode === opt.value;
					return (
						<button
							type="button"
							key={opt.value}
							onClick={() => onChange(opt.value)}
							aria-pressed={active}
							className={cn(
								"flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition outline-none",
								active
									? "border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]"
									: "border-[var(--theme-border)] hover:border-[var(--theme-border-strong)]",
								"focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]",
							)}
						>
							<div className="flex items-center gap-2">
								<Icon className="size-4 text-[var(--theme-accent)]" />
								<span className="text-sm font-medium">{opt.label}</span>
							</div>
							<span className="text-xs text-muted-foreground">
								{opt.description}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function InteractionsFields({
	form,
	onChange,
}: {
	form: FormState;
	onChange: (patch: Partial<FormState>) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-sm font-medium">
				<MessageSquare className="size-4 text-muted-foreground" />
				Interactions
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<NumberField
					label="First ask after"
					suffix="messages"
					value={form.interactions_first}
					min={1}
					max={1000}
					onChange={(n) => onChange({ interactions_first: n })}
				/>
				<NumberField
					label="Then every"
					suffix="messages"
					value={form.interactions_repeat}
					min={1}
					max={1000}
					onChange={(n) => onChange({ interactions_repeat: n })}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				Counted as user-sent messages across all conversations in the same
				browser. After a user rates or dismisses, the next ask is{" "}
				<strong>{form.interactions_repeat}</strong> messages later.
			</p>
		</div>
	);
}

function TimeFields({
	form,
	onChange,
}: {
	form: FormState;
	onChange: (patch: Partial<FormState>) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-sm font-medium">
				<Clock className="size-4 text-muted-foreground" />
				Time
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<DurationField
					label="First ask after"
					value={form.time_first_value}
					unit={form.time_first_unit}
					onChangeValue={(v) => onChange({ time_first_value: v })}
					onChangeUnit={(u) => onChange({ time_first_unit: u })}
				/>
				<DurationField
					label="Then every"
					value={form.time_repeat_value}
					unit={form.time_repeat_unit}
					onChangeValue={(v) => onChange({ time_repeat_value: v })}
					onChangeUnit={(u) => onChange({ time_repeat_unit: u })}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				Time runs from the user's first message in this browser. After a user
				rates or dismisses, the next ask waits at least the repeat interval.
			</p>
		</div>
	);
}

function ReRateFields({
	form,
	onChange,
}: {
	form: FormState;
	onChange: (patch: Partial<FormState>) => void;
}) {
	const enabled = form.re_rate_after_messages > 0;
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-dashed border-[var(--theme-border)] p-3">
			<div className="flex items-center gap-2 text-sm font-medium">
				<RotateCw className="size-4 text-muted-foreground" />
				Re-rate long conversations
			</div>
			<div className="grid gap-3 sm:grid-cols-[auto_1fr]">
				<NumberField
					label="Re-ask the same conversation after"
					suffix="more messages (0 = never)"
					value={form.re_rate_after_messages}
					min={0}
					max={1000}
					onChange={(n) => onChange({ re_rate_after_messages: n })}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				{enabled ? (
					<>
						Once a user rates a conversation, the card stays hidden until they
						send <strong>{form.re_rate_after_messages}</strong> more messages in
						that same thread. Useful for long-running conversations whose
						quality may drift over time. The new rating overwrites the old.
					</>
				) : (
					<>
						Rated conversations stay locked forever. Set this above 0 to let
						users re-rate long-running threads as quality drifts.
					</>
				)}
			</p>
		</div>
	);
}

function NumberField({
	label,
	suffix,
	value,
	min,
	max,
	onChange,
}: {
	label: string;
	suffix?: string;
	value: number;
	min: number;
	max: number;
	onChange: (next: number) => void;
}) {
	// Biome's `noLabelWithoutControl` doesn't see through the custom `<Input>`
	// component, so we use a `<div>` group with an `aria-label` on the input
	// instead of wrapping with `<label>`.
	return (
		<div className="flex flex-col gap-1.5 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2">
				<Input
					type="number"
					min={min}
					max={max}
					value={value}
					aria-label={label}
					onChange={(e) => {
						const n = Number(e.target.value);
						if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
					}}
					className="w-24"
				/>
				{suffix ? (
					<span className="text-xs text-muted-foreground">{suffix}</span>
				) : null}
			</div>
		</div>
	);
}

function DurationField({
	label,
	value,
	unit,
	onChangeValue,
	onChangeUnit,
}: {
	label: string;
	value: number;
	unit: DurationUnit;
	onChangeValue: (next: number) => void;
	onChangeUnit: (next: DurationUnit) => void;
}) {
	// Two controls (input + select) share one label, so we use a `<div>` group
	// with `aria-label` on each control instead of a `<label>` wrap (which
	// can only associate with one control).
	return (
		<div className="flex flex-col gap-1.5 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2">
				<Input
					type="number"
					min={1}
					value={value}
					aria-label={`${label} (value)`}
					onChange={(e) => {
						const n = Number(e.target.value);
						if (Number.isFinite(n) && n >= 1) onChangeValue(n);
					}}
					className="w-24"
				/>
				<select
					value={unit}
					aria-label={`${label} (unit)`}
					onChange={(e) => onChangeUnit(e.target.value as DurationUnit)}
					className="h-9 rounded-md border border-[var(--theme-border)] bg-transparent px-2 text-sm outline-none focus-visible:border-[var(--theme-accent)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]"
				>
					<option value="minutes">minutes</option>
					<option value="hours">hours</option>
					<option value="days">days</option>
				</select>
			</div>
		</div>
	);
}

function FormSkeleton() {
	return (
		<Card className="gap-3 py-4 sm:py-6">
			<CardHeader className="px-4 sm:px-6">
				<Skeleton className="h-5 w-48" />
				<Skeleton className="h-4 w-64" />
			</CardHeader>
			<CardContent className="flex flex-col gap-3 px-4 sm:px-6">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-32 w-full" />
			</CardContent>
		</Card>
	);
}
