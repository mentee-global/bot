import type { ReactNode } from "react";
import { InfoTooltip } from "#/components/ui/info-tooltip";

/**
 * A labeled field whose visible label wraps a custom Input component. Extracted
 * into its own file so a single biome-ignore can cover the wrapping `<label>`
 * without the linter choking on the custom-component-as-control pattern.
 *
 * `tooltip` renders an (i) icon next to the label with an on-hover/focus
 * popover — use for field-level "what does this mean" help. `hint` still
 * shows below the input for the most important one-line context.
 */
export function Field({
	label,
	hint,
	tooltip,
	children,
}: {
	label: string;
	hint?: string;
	tooltip?: ReactNode;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: children render a native input beneath this label.
		<label className="flex flex-col gap-1 text-sm">
			<span className="inline-flex items-center gap-1.5 font-medium">
				{label}
				{tooltip ? <InfoTooltip title={label}>{tooltip}</InfoTooltip> : null}
			</span>
			{children}
			{hint ? (
				<span className="text-xs text-muted-foreground">{hint}</span>
			) : null}
		</label>
	);
}
