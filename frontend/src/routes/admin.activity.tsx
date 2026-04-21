import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route: renders the activity surface. Children are either the index
// list (admin.activity.index.tsx) or the thread detail
// (admin.activity.$threadId.tsx). The layout itself owns no UI — admin.tsx
// already provides the admin chrome.
export const Route = createFileRoute("/admin/activity")({
	component: Outlet,
});
