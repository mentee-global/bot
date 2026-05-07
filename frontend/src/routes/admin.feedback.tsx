import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	FeedbackOverview,
	MessageReactionsTable,
	SessionRatingsTable,
} from "#/features/admin/components/FeedbackSection";
import { TriggerConfigForm } from "#/features/admin/components/TriggerConfigForm";

export const FEEDBACK_SECTIONS = [
	"overview",
	"ratings",
	"reactions",
	"configuration",
] as const;
export type FeedbackSection = (typeof FEEDBACK_SECTIONS)[number];

export function feedbackSectionLabel(section: FeedbackSection): string {
	if (section === "overview") return "Overview";
	if (section === "ratings") return "Session ratings";
	if (section === "reactions") return "Message reactions";
	return "Configuration";
}

// ---------------------------------------------------------------------------
// Search-param schema
//
// Filters are kept in the URL so that:
// - admins can share / bookmark a triage view (e.g. low-star + has-comment),
// - back-navigating from a thread returns to the same page/filter state,
// - the parent route can validate everything in one place rather than each
//   subview parsing on its own.
// ---------------------------------------------------------------------------

export type CommentFilter = "all" | "yes" | "no";
export type ThumbsFilter = "all" | "up" | "down";

const COMMENT_FILTERS: readonly CommentFilter[] = ["all", "yes", "no"];
const THUMBS_FILTERS: readonly ThumbsFilter[] = ["all", "up", "down"];

export type FeedbackSearch = {
	section: FeedbackSection;
	page?: number;
	q?: string;
	min?: number; // min stars (1..5)
	max?: number; // max stars (1..5)
	comments?: CommentFilter;
	rating?: ThumbsFilter;
};

function isFeedbackSection(value: unknown): value is FeedbackSection {
	return (
		typeof value === "string" &&
		(FEEDBACK_SECTIONS as readonly string[]).includes(value)
	);
}

function parsePage(raw: unknown): number | undefined {
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string"
				? Number.parseInt(raw, 10)
				: undefined;
	return n !== undefined && Number.isFinite(n) && n > 1 ? n : undefined;
}

function parseEnum<T extends string>(raw: unknown, allowed: readonly T[]) {
	if (typeof raw !== "string") return undefined;
	return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

function parseStr(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseStars(raw: unknown): number | undefined {
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string"
				? Number.parseInt(raw, 10)
				: undefined;
	if (n === undefined || !Number.isFinite(n)) return undefined;
	if (n < 1 || n > 5) return undefined;
	return n;
}

export const Route = createFileRoute("/admin/feedback")({
	component: FeedbackRoute,
	validateSearch: (search: Record<string, unknown>): FeedbackSearch => ({
		section: isFeedbackSection(search.section) ? search.section : "overview",
		page: parsePage(search.page),
		q: parseStr(search.q),
		min: parseStars(search.min),
		max: parseStars(search.max),
		comments: parseEnum(search.comments, COMMENT_FILTERS),
		rating: parseEnum(search.rating, THUMBS_FILTERS),
	}),
});

function FeedbackRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate();

	// Keep navigation typed and in one place. Each section owns the search
	// keys it cares about — when switching sections we drop the others so
	// e.g. a `?rating=down` left over from the reactions page doesn't bleed
	// into the ratings query.
	const updateSearch = (next: Partial<FeedbackSearch>) => {
		navigate({
			to: "/admin/feedback",
			search: { ...search, ...next },
			replace: true,
		});
	};

	if (search.section === "configuration") {
		return (
			<section className="flex min-w-0 flex-col gap-3">
				<TriggerConfigForm />
			</section>
		);
	}

	if (search.section === "ratings") {
		return (
			<section className="flex min-w-0 flex-col gap-3">
				<SessionRatingsTable
					page={search.page ?? 1}
					q={search.q ?? ""}
					min={search.min ?? 1}
					max={search.max ?? 5}
					comments={search.comments ?? "all"}
					onChange={(next) =>
						updateSearch({
							page: next.page,
							q: next.q,
							min: next.min,
							max: next.max,
							comments: next.comments,
						})
					}
				/>
			</section>
		);
	}

	if (search.section === "reactions") {
		return (
			<section className="flex min-w-0 flex-col gap-3">
				<MessageReactionsTable
					page={search.page ?? 1}
					q={search.q ?? ""}
					rating={search.rating ?? "all"}
					onChange={(next) =>
						updateSearch({
							page: next.page,
							q: next.q,
							rating: next.rating,
						})
					}
				/>
			</section>
		);
	}

	return (
		<section className="flex min-w-0 flex-col gap-3">
			<FeedbackOverview />
		</section>
	);
}
