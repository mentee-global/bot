import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { Card } from "#/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { cn } from "#/lib/utils";

export interface DataTableProps<TData> {
	data: TData[];
	columns: ColumnDef<TData, unknown>[];
	onRowClick?: (row: TData) => void;
	isFetching?: boolean;
	emptyState?: React.ReactNode;
	initialSorting?: SortingState;
	// When true, the table body is capped at a viewport-relative height and
	// scrolls internally with a sticky header — so long tables don't drag the
	// page scrollbar along. Short tables stay at natural height.
	fillHeight?: boolean;
}

export function DataTable<TData>({
	data,
	columns,
	onRowClick,
	isFetching,
	emptyState,
	initialSorting,
	fillHeight,
}: DataTableProps<TData>) {
	const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);

	const table = useReactTable({
		data,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	const rows = table.getRowModel().rows;

	return (
		<Card
			className={cn(
				"overflow-hidden p-0 transition-opacity",
				fillHeight &&
					"[&>[data-slot=table-container]]:max-h-[calc(100dvh-22rem)] [&>[data-slot=table-container]]:overflow-auto",
				isFetching && "opacity-60",
			)}
			aria-busy={isFetching || undefined}
		>
			<Table>
				<TableHeader className={cn(fillHeight && "sticky top-0 z-10 bg-card")}>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => {
								const canSort = header.column.getCanSort();
								const sortState = header.column.getIsSorted();
								return (
									<TableHead
										key={header.id}
										style={{
											width: header.getSize() || undefined,
										}}
									>
										{canSort ? (
											<button
												type="button"
												onClick={header.column.getToggleSortingHandler()}
												className="inline-flex cursor-pointer items-center gap-1.5 text-left font-medium hover:text-foreground"
											>
												{flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
												<SortIcon state={sortState} />
											</button>
										) : (
											flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)
										)}
									</TableHead>
								);
							})}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={columns.length}
								className="h-24 text-center text-sm text-muted-foreground"
							>
								{emptyState ?? "No results."}
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<TableRow
								key={row.id}
								onClick={
									onRowClick ? () => onRowClick(row.original) : undefined
								}
								className={cn(onRowClick && "cursor-pointer")}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</Card>
	);
}

function SortIcon({ state }: { state: false | "asc" | "desc" }) {
	if (state === "asc") return <ArrowUp className="size-3" />;
	if (state === "desc") return <ArrowDown className="size-3" />;
	return <ArrowUpDown className="size-3 text-muted-foreground" />;
}
