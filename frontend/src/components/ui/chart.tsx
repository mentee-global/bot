// Adapted from shadcn/ui chart primitives for recharts 3.x. Theme tokens are
// projected as CSS custom properties (--color-<key>) onto the chart wrapper so
// recharts elements can reference them via `var(--color-foo)`.

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "#/lib/utils";

const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
	[k in string]: {
		label?: React.ReactNode;
		icon?: React.ComponentType;
	} & (
		| { color?: string; theme?: never }
		| { color?: never; theme: Record<keyof typeof THEMES, string> }
	);
};

type ChartContextProps = {
	config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
	const ctx = React.useContext(ChartContext);
	if (!ctx) {
		throw new Error("useChart must be used within a <ChartContainer />");
	}
	return ctx;
}

function ChartContainer({
	id,
	className,
	children,
	config,
	...props
}: React.ComponentProps<"div"> & {
	config: ChartConfig;
	children: React.ComponentProps<
		typeof RechartsPrimitive.ResponsiveContainer
	>["children"];
}) {
	const uniqueId = React.useId();
	const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

	return (
		<ChartContext.Provider value={{ config }}>
			<div
				data-slot="chart"
				data-chart={chartId}
				className={cn(
					// `min-w-0` so the wrapper can shrink below its child SVG inside
					// flex/grid parents; `overflow-hidden` clips any pixel-rounding
					// overflow from recharts' ResponsiveContainer when the parent
					// resizes past the chart's last-measured width. We don't keep
					// shadcn's default `aspect-video` because callers always set an
					// explicit height — pairing both with a percentage width can
					// keep the box at the aspect-ratio width during a viewport
					// shrink, bleeding the chart past the card on mobile.
					"flex min-w-0 justify-center overflow-hidden text-xs",
					"[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
					"[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50",
					"[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
					"[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border",
					"[&_.recharts-radial-bar-background-sector]:fill-muted",
					"[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted",
					"[&_.recharts-reference-line_[stroke='#ccc']]:stroke-border",
					"[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
					"[&_.recharts-layer]:outline-hidden",
					"[&_.recharts-sector]:outline-hidden",
					"[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
					"[&_.recharts-surface]:outline-hidden",
					className,
				)}
				{...props}
			>
				<ChartStyle id={chartId} config={config} />
				{/*
				 * `minWidth`/`minHeight={1}` silences recharts' "width(-1) and
				 * height(-1)" warning fired on the very first measurement while
				 * the parent flex/grid layout is still settling — once the real
				 * size lands via ResizeObserver the chart resizes normally.
				 */}
				<RechartsPrimitive.ResponsiveContainer minWidth={1} minHeight={1}>
					{children}
				</RechartsPrimitive.ResponsiveContainer>
			</div>
		</ChartContext.Provider>
	);
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
	const colorConfig = Object.entries(config).filter(
		([, v]) => v.theme || v.color,
	);
	if (!colorConfig.length) return null;

	return (
		<style
			// biome-ignore lint/security/noDangerouslySetInnerHtml: chart css vars
			dangerouslySetInnerHTML={{
				__html: Object.entries(THEMES)
					.map(
						([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
	.map(([key, item]) => {
		const color = item.theme?.[theme as keyof typeof item.theme] || item.color;
		return color ? `  --color-${key}: ${color};` : null;
	})
	.filter(Boolean)
	.join("\n")}
}
`,
					)
					.join("\n"),
			}}
		/>
	);
};

const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipPayloadEntry = {
	value?: number | string;
	name?: string;
	dataKey?: string | number;
	color?: string;
	payload?: Record<string, unknown> & { fill?: string };
};

function ChartTooltipContent({
	active,
	payload,
	className,
	indicator = "dot",
	hideLabel = false,
	hideIndicator = false,
	label,
	labelFormatter,
	labelClassName,
	formatter,
	color,
	nameKey,
	labelKey,
}: {
	active?: boolean;
	payload?: TooltipPayloadEntry[];
	className?: string;
	indicator?: "line" | "dot" | "dashed";
	hideLabel?: boolean;
	hideIndicator?: boolean;
	label?: React.ReactNode;
	labelFormatter?: (
		value: React.ReactNode,
		payload: TooltipPayloadEntry[],
	) => React.ReactNode;
	labelClassName?: string;
	formatter?: (
		value: number | string | undefined,
		name: string | undefined,
		item: TooltipPayloadEntry,
		index: number,
		payload: Record<string, unknown> | undefined,
	) => React.ReactNode;
	color?: string;
	nameKey?: string;
	labelKey?: string;
}) {
	const { config } = useChart();

	const tooltipLabel = React.useMemo(() => {
		if (hideLabel || !payload?.length) return null;
		const [item] = payload;
		const key = `${labelKey || item.dataKey || item.name || "value"}`;
		const itemConfig = getPayloadConfigFromPayload(config, item, key);
		const value =
			!labelKey && typeof label === "string"
				? config[label]?.label || label
				: itemConfig?.label;
		if (labelFormatter) {
			return (
				<div className={cn("font-medium", labelClassName)}>
					{labelFormatter(value, payload)}
				</div>
			);
		}
		if (!value) return null;
		return <div className={cn("font-medium", labelClassName)}>{value}</div>;
	}, [
		label,
		labelFormatter,
		payload,
		hideLabel,
		labelClassName,
		config,
		labelKey,
	]);

	if (!active || !payload?.length) return null;
	const nestLabel = payload.length === 1 && indicator !== "dot";

	return (
		<div
			className={cn(
				"grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
				className,
			)}
		>
			{!nestLabel ? tooltipLabel : null}
			<div className="grid gap-1.5">
				{payload.map((item, index) => {
					const key = `${nameKey || item.name || item.dataKey || "value"}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);
					const indicatorColor = color || item.payload?.fill || item.color;
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: tooltip rows are stable per render
							key={`${item.dataKey}-${index}`}
							className={cn(
								"flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
								indicator === "dot" && "items-center",
							)}
						>
							{formatter && item.value !== undefined && item.name ? (
								formatter(item.value, item.name, item, index, item.payload)
							) : (
								<>
									{itemConfig?.icon ? (
										<itemConfig.icon />
									) : (
										!hideIndicator && (
											<div
												className={cn(
													"shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
													{
														"h-2.5 w-2.5": indicator === "dot",
														"w-1": indicator === "line",
														"w-0 border-[1.5px] border-dashed bg-transparent":
															indicator === "dashed",
														"my-0.5": nestLabel && indicator === "dashed",
													},
												)}
												style={
													{
														"--color-bg": indicatorColor,
														"--color-border": indicatorColor,
													} as React.CSSProperties
												}
											/>
										)
									)}
									<div
										className={cn(
											"flex flex-1 justify-between leading-none",
											nestLabel ? "items-end" : "items-center",
										)}
									>
										<div className="grid gap-1.5">
											{nestLabel ? tooltipLabel : null}
											<span className="text-muted-foreground">
												{itemConfig?.label || item.name}
											</span>
										</div>
										{item.value !== undefined ? (
											<span className="font-mono font-medium tabular-nums text-foreground">
												{typeof item.value === "number"
													? item.value.toLocaleString()
													: item.value}
											</span>
										) : null}
									</div>
								</>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function getPayloadConfigFromPayload(
	config: ChartConfig,
	payload: TooltipPayloadEntry | undefined,
	key: string,
) {
	if (!payload) return undefined;
	const inner =
		payload.payload && typeof payload.payload === "object"
			? (payload.payload as Record<string, unknown>)
			: undefined;
	let configLabelKey: string = key;
	if (typeof payload[key as keyof typeof payload] === "string") {
		configLabelKey = payload[key as keyof typeof payload] as string;
	} else if (inner && typeof inner[key] === "string") {
		configLabelKey = inner[key] as string;
	}
	return configLabelKey in config ? config[configLabelKey] : config[key];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartStyle };
