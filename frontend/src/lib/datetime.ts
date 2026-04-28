function toDate(input: string | Date): Date {
	return input instanceof Date ? input : new Date(input);
}

export function isSameDay(a: string | Date, b: string | Date): boolean {
	const da = toDate(a);
	const db = toDate(b);
	return (
		da.getFullYear() === db.getFullYear() &&
		da.getMonth() === db.getMonth() &&
		da.getDate() === db.getDate()
	);
}

export function formatTime(input: string | Date): string {
	return toDate(input).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatRelative(input: string | Date): string {
	const d = toDate(input);
	const diffMs = Date.now() - d.getTime();
	const diffMin = Math.round(diffMs / 60_000);
	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin} min ago`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr} hr ago`;
	return formatTime(d);
}

interface DateDividerLabels {
	today: string;
	yesterday: string;
}

const DEFAULT_LABELS: DateDividerLabels = {
	today: "Today",
	yesterday: "Yesterday",
};

export function formatDateDivider(
	input: string | Date,
	labels: DateDividerLabels = DEFAULT_LABELS,
): string {
	const d = toDate(input);
	const now = new Date();
	if (isSameDay(d, now)) return labels.today;
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (isSameDay(d, yesterday)) return labels.yesterday;
	const sameYear = d.getFullYear() === now.getFullYear();
	return d.toLocaleDateString(undefined, {
		weekday: sameYear ? "short" : undefined,
		month: "short",
		day: "numeric",
		year: sameYear ? undefined : "numeric",
	});
}

export function formatFullTimestamp(input: string | Date): string {
	return toDate(input).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

const SHORT_BURST_MS = 5 * 60 * 1000;

export function isCloseInTime(a: string | Date, b: string | Date): boolean {
	return Math.abs(toDate(a).getTime() - toDate(b).getTime()) < SHORT_BURST_MS;
}
