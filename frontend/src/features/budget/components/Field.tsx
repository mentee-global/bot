import type { ReactNode } from "react";

/**
 * A labeled field whose visible label wraps a custom Input component. Extracted
 * into its own file so a single biome-ignore can cover the wrapping `<label>`
 * without the linter choking on the custom-component-as-control pattern.
 */
export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: children render a native input beneath this label.
		<label className="flex flex-col gap-1 text-sm">
			<span className="font-medium">{label}</span>
			{children}
			{hint ? (
				<span className="text-xs text-muted-foreground">{hint}</span>
			) : null}
		</label>
	);
}
