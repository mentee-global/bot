import { formatDateDivider } from "#/lib/datetime";
import { m } from "#/paraglide/messages";

interface DateDividerProps {
	iso: string;
}

export function DateDivider({ iso }: DateDividerProps) {
	const label = formatDateDivider(iso, {
		today: m.chat_date_today(),
		yesterday: m.chat_date_yesterday(),
	});

	return (
		<div
			aria-hidden="true"
			className="relative my-2 flex items-center gap-3 text-[11px] uppercase tracking-wide text-[var(--theme-muted)]"
		>
			<span className="h-px flex-1 bg-[var(--theme-border)]" />
			<span className="font-medium">{label}</span>
			<span className="h-px flex-1 bg-[var(--theme-border)]" />
		</div>
	);
}
