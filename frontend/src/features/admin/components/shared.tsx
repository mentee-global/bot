import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationNext,
	PaginationPrevious,
} from "#/components/ui/pagination";
import { Skeleton } from "#/components/ui/Skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export function EmptyState({ message }: { message: string }) {
	return (
		<Card className="items-center justify-center py-10">
			<p className="text-sm text-muted-foreground">{message}</p>
		</Card>
	);
}

export function LoadingState() {
	return (
		<Card className="items-center justify-center py-10">
			<p className="text-sm text-muted-foreground">{m.admin_loading()}</p>
		</Card>
	);
}

export function ErrorState({ message }: { message: string }) {
	return (
		<Card className="items-center justify-center py-10">
			<p className="text-sm text-destructive">{message}</p>
		</Card>
	);
}

export function ResultsCount({
	total,
	pageSize,
	page,
	shown,
}: {
	total: number;
	pageSize: number;
	page: number;
	shown: number;
}) {
	if (total === 0) return null;
	const from = (page - 1) * pageSize + 1;
	const to = (page - 1) * pageSize + shown;
	return (
		<p className="m-0 text-xs text-muted-foreground">
			{m.admin_results_count({ from, to, total })}
		</p>
	);
}

export function AdminPagination({
	page,
	total,
	pageSize,
	onChange,
}: {
	page: number;
	total: number;
	pageSize: number;
	onChange: (page: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	if (totalPages <= 1) return null;
	const canPrev = page > 1;
	const canNext = page < totalPages;
	return (
		<Pagination aria-label={m.admin_pagination_label()}>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						onClick={(e) => {
							e.preventDefault();
							if (canPrev) onChange(page - 1);
						}}
						className={cn(!canPrev && "pointer-events-none opacity-50")}
						aria-disabled={!canPrev}
					/>
				</PaginationItem>
				<PaginationItem>
					<span className="flex items-center px-2 text-xs text-muted-foreground">
						{m.admin_page_indicator({ page, total: totalPages })}
					</span>
				</PaginationItem>
				<PaginationItem>
					<PaginationNext
						onClick={(e) => {
							e.preventDefault();
							if (canNext) onChange(page + 1);
						}}
						className={cn(!canNext && "pointer-events-none opacity-50")}
						aria-disabled={!canNext}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}

export function CompactDate({ iso }: { iso: string }) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return <>—</>;
	const short = date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
	return (
		<time
			dateTime={iso}
			title={date.toLocaleString()}
			className="whitespace-nowrap"
		>
			{short}
		</time>
	);
}

export function Muted({ children }: { children: ReactNode }) {
	return <span className="text-muted-foreground">{children}</span>;
}

export function RolePill({ role }: { role: string }) {
	return (
		<Badge
			variant={role === "admin" ? "default" : "outline"}
			className="text-[10px] uppercase tracking-wide"
		>
			{role || "—"}
		</Badge>
	);
}

export function StatItem({
	label,
	value,
}: {
	label: string;
	value: ReactNode;
}) {
	return (
		<div>
			<dt className="m-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="m-0 mt-0.5 text-sm font-medium">{value}</dd>
		</div>
	);
}

export function BackLink({
	onClick,
	children,
}: {
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={onClick}
			className="gap-1 px-0 text-xs text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft size={14} /> {children}
		</Button>
	);
}

export function AdminShellSkeleton() {
	return (
		<main className="page-wrap px-3 py-5 sm:px-6 sm:py-10">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="mt-6 h-64 rounded-xl" />
		</main>
	);
}

export function DataTableSkeleton({
	columns,
	rows = 10,
	fillHeight,
}: {
	columns: Array<{ width?: number; align?: "right" }>;
	rows?: number;
	fillHeight?: boolean;
}) {
	const rowIndexes = Array.from({ length: rows }, (_, i) => i);
	return (
		<Card
			aria-busy
			aria-label={m.admin_loading()}
			className={cn(
				"overflow-hidden p-0",
				fillHeight &&
					"flex min-h-0 flex-1 flex-col [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:flex-1 [&>[data-slot=table-container]]:overflow-auto",
			)}
		>
			<Table>
				<TableHeader className={cn(fillHeight && "sticky top-0 z-10 bg-card")}>
					<TableRow>
						{columns.map((col, i) => (
							<TableHead
								// biome-ignore lint/suspicious/noArrayIndexKey: shape is static for a given page
								key={i}
								style={{ width: col.width || undefined }}
							>
								<Skeleton
									className={cn(
										"h-3.5 w-20",
										col.align === "right" && "ml-auto",
									)}
								/>
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rowIndexes.map((r) => (
						<TableRow key={r}>
							{columns.map((col, c) => (
								<TableCell
									// biome-ignore lint/suspicious/noArrayIndexKey: shape is static
									key={c}
								>
									<Skeleton
										className={cn(
											"h-4",
											col.align === "right" ? "ml-auto w-10" : "w-3/4",
										)}
									/>
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Card>
	);
}

export function MobileCardListSkeleton({ rows = 6 }: { rows?: number }) {
	const items = Array.from({ length: rows }, (_, i) => i);
	return (
		<ul
			className="flex flex-col gap-2"
			aria-busy
			aria-label={m.admin_loading()}
		>
			{items.map((i) => (
				<li key={i} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="mt-2 h-3 w-1/2" />
					<Skeleton className="mt-2 h-3 w-1/3" />
				</li>
			))}
		</ul>
	);
}

export function StatsTilesSkeleton({ count = 4 }: { count?: number }) {
	const tiles = Array.from({ length: count }, (_, i) => i);
	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
			{tiles.map((i) => (
				<Card key={i} className="gap-1.5 py-4">
					<div className="px-4">
						<Skeleton className="h-2.5 w-16" />
						<Skeleton className="mt-2 h-6 w-12" />
					</div>
				</Card>
			))}
		</div>
	);
}
