import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DataTable, type DataTableColumnDef } from "./DataTable";

type Person = { name: string };

const columns: DataTableColumnDef<Person>[] = [
	{ accessorKey: "name", header: "Name", cell: (info) => info.getValue() },
];

afterEach(() => {
	cleanup();
});

it("keeps header sorting and row rendering after the table v9 migration", () => {
	render(
		<DataTable data={[{ name: "Zoe" }, { name: "Ada" }]} columns={columns} />,
	);

	expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
		"Zoe",
		"Ada",
	]);

	fireEvent.click(screen.getByRole("button", { name: /Name/ }));

	expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
		"Ada",
		"Zoe",
	]);
});
