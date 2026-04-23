/**
 * Turn integer USD-micros into a human-readable dollar string.
 * Backend stores every monetary value as USD × 1_000_000 so totals over many
 * turns don't drift from float math.
 */
export function formatMicros(
	micros: number | null | undefined,
	opts: { precision?: number } = {},
): string {
	if (micros == null) return "—";
	const precision = opts.precision ?? 2;
	const usd = micros / 1_000_000;
	return `$${usd.toLocaleString(undefined, {
		minimumFractionDigits: precision,
		maximumFractionDigits: precision,
	})}`;
}

export function microsToUsd(micros: number | null | undefined): number {
	return (micros ?? 0) / 1_000_000;
}

export function usdToMicros(usd: string | number): number {
	const n = typeof usd === "string" ? Number.parseFloat(usd) : usd;
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.round(n * 1_000_000);
}

export function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}
