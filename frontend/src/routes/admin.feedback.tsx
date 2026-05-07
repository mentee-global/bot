import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	FeedbackOverview,
	MessageReactionsTable,
	SessionRatingsTable,
} from "#/features/admin/components/FeedbackSection";
import { TriggerConfigForm } from "#/features/admin/components/TriggerConfigForm";

export const FEEDBACK_SECTIONS = ["details", "configuration"] as const;
export type FeedbackSection = (typeof FEEDBACK_SECTIONS)[number];

export function feedbackSectionLabel(section: FeedbackSection): string {
	if (section === "configuration") return "Configuration";
	return "Details";
}

const TABS = ["ratings", "reactions"] as const;
type FeedbackTab = (typeof TABS)[number];

type FeedbackSearch = {
	section: FeedbackSection;
	tab?: FeedbackTab;
};

function isFeedbackSection(value: unknown): value is FeedbackSection {
	return (
		typeof value === "string" &&
		(FEEDBACK_SECTIONS as readonly string[]).includes(value)
	);
}

function parseTab(raw: unknown): FeedbackTab | undefined {
	return typeof raw === "string" && (TABS as readonly string[]).includes(raw)
		? (raw as FeedbackTab)
		: undefined;
}

export const Route = createFileRoute("/admin/feedback")({
	component: FeedbackRoute,
	validateSearch: (search: Record<string, unknown>): FeedbackSearch => ({
		section: isFeedbackSection(search.section) ? search.section : "details",
		tab: parseTab(search.tab),
	}),
});

function FeedbackRoute() {
	const search = Route.useSearch();
	if (search.section === "configuration") {
		return <ConfigurationPage />;
	}
	return <DetailsPage activeTab={search.tab ?? "ratings"} />;
}

// ---------------------------------------------------------------------------
// Details — overview + the two tables (gated by tabs)
// ---------------------------------------------------------------------------

function DetailsPage({ activeTab }: { activeTab: FeedbackTab }) {
	const navigate = useNavigate();

	const setTab = (next: FeedbackTab) => {
		navigate({
			to: "/admin/feedback",
			search: {
				section: "details",
				tab: next === "ratings" ? undefined : next,
			},
			replace: true,
		});
	};

	return (
		<section className="flex min-w-0 flex-col gap-8">
			<div className="flex min-w-0 flex-col gap-3">
				<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:text-sm">
					Overview
				</h2>
				<FeedbackOverview />
			</div>

			<div className="flex min-w-0 flex-col gap-3">
				<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:text-sm">
					Feedback
				</h2>
				<Tabs
					value={activeTab}
					onValueChange={(v) => setTab(v as FeedbackTab)}
					className="gap-3"
				>
					<TabsList>
						<TabsTrigger value="ratings">Session ratings</TabsTrigger>
						<TabsTrigger value="reactions">Message reactions</TabsTrigger>
					</TabsList>
					<TabsContent value="ratings">
						<SessionRatingsTable />
					</TabsContent>
					<TabsContent value="reactions">
						<MessageReactionsTable />
					</TabsContent>
				</Tabs>
			</div>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Configuration — cadence form, isolated from the data view
// ---------------------------------------------------------------------------

function ConfigurationPage() {
	return (
		<section className="flex min-w-0 flex-col gap-3">
			<TriggerConfigForm />
		</section>
	);
}
