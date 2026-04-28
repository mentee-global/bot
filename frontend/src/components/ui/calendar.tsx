import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { buttonVariants } from "#/components/ui/button";
import { cn } from "#/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	...props
}: CalendarProps) {
	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn("p-3", className)}
			classNames={{
				months: "flex flex-col sm:flex-row gap-2",
				month: "flex flex-col gap-4",
				month_caption: "flex justify-center pt-1 relative items-center",
				caption_label: "text-sm font-medium",
				nav: "flex items-center justify-between absolute inset-x-1 top-1",
				button_previous: cn(
					buttonVariants({ variant: "outline" }),
					"size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
				),
				button_next: cn(
					buttonVariants({ variant: "outline" }),
					"size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
				),
				month_grid: "w-full border-collapse",
				weekdays: "flex",
				weekday:
					"text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
				week: "flex w-full mt-2",
				day: cn(
					"relative p-0 text-center text-sm h-8 w-8 focus-within:relative focus-within:z-20",
					"[&:has([aria-selected])]:bg-accent",
					"[&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/40",
					"[&:has([aria-selected].day-range-middle)]:rounded-none",
					"first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
				),
				day_button: cn(
					buttonVariants({ variant: "ghost" }),
					"size-8 p-0 font-normal aria-selected:opacity-100",
				),
				range_start: "day-range-start rounded-l-md bg-primary",
				range_end: "day-range-end rounded-r-md bg-primary",
				selected:
					"bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
				today: "bg-accent text-accent-foreground",
				outside:
					"day-outside text-muted-foreground aria-selected:text-muted-foreground",
				disabled: "text-muted-foreground opacity-50",
				range_middle:
					"day-range-middle aria-selected:bg-accent aria-selected:text-accent-foreground rounded-none",
				hidden: "invisible",
				...classNames,
			}}
			components={{
				Chevron: ({ orientation, ...rest }) =>
					orientation === "left" ? (
						<ChevronLeft className="size-4" {...rest} />
					) : (
						<ChevronRight className="size-4" {...rest} />
					),
			}}
			{...props}
		/>
	);
}

export { Calendar };
