import { Skeleton } from "#/components/ui/Skeleton";

/**
 * Skeleton for the thread sidebar list while the first fetch is in flight.
 * Kept deliberately simple — three shimmering rows feel like real thread
 * titles without guessing at their length.
 */
export function ThreadListSkeleton() {
	return (
		<ul className="m-0 flex flex-col gap-1 p-0">
			{[72, 56, 64, 48].map((width, i) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
					key={i}
					className="flex items-center gap-2 rounded-md px-2.5 py-2"
				>
					<Skeleton
						className="h-3.5 rounded-full"
						style={{ width: `${width}%` }}
					/>
				</li>
			))}
		</ul>
	);
}

/**
 * Skeleton for the message pane while a thread loads. Alternates sender sides
 * so the placeholder echoes the final layout.
 */
export function MessageListSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<BubbleSkeleton side="right" lines={1} widthPct={45} />
			<BubbleSkeleton side="left" lines={3} widthPct={72} />
			<BubbleSkeleton side="right" lines={1} widthPct={30} />
			<BubbleSkeleton side="left" lines={2} widthPct={65} />
		</div>
	);
}

function BubbleSkeleton({
	side,
	lines,
	widthPct,
}: {
	side: "left" | "right";
	lines: number;
	widthPct: number;
}) {
	return (
		<div
			className={`flex w-full ${side === "right" ? "justify-end" : "justify-start"}`}
		>
			<div
				className={`flex max-w-[80%] flex-col gap-1.5 rounded-2xl px-4 py-2.5 ${
					side === "right"
						? "bg-[var(--theme-border)]/60"
						: "border border-[var(--theme-border)] bg-[var(--theme-surface)]"
				}`}
				style={{ width: `${widthPct}%` }}
			>
				{Array.from({ length: lines }).map((_, i) => (
					<Skeleton
						// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
						key={i}
						className="h-3 rounded"
						style={{ width: i === lines - 1 ? "78%" : "100%" }}
					/>
				))}
			</div>
		</div>
	);
}
