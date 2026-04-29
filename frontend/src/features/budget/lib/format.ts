/**
 * Turn integer USD-micros into a human-readable dollar string.
 * Backend stores every monetary value as USD × 1_000_000 so totals over many
 * turns don't drift from float math.
 *
 * `precision: "auto"` switches to 4 decimals when the absolute value is below
 * one cent, otherwise stays at 2. Use it for tiles that summarise a wide range
 * of magnitudes (per-period spend can be either $14.32 or $0.0008) where a
 * fixed precision either rounds sub-cent values to $0.00 or makes large values
 * look noisy.
 */
export function formatMicros(
	micros: number | null | undefined,
	opts: { precision?: number | "auto" } = {},
): string {
	if (micros == null) return "—";
	const usd = micros / 1_000_000;
	const precision =
		opts.precision === "auto"
			? Math.abs(usd) < 0.01 && usd !== 0
				? 4
				: 2
			: (opts.precision ?? 2);
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
