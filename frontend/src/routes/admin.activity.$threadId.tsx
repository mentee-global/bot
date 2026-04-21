import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ThreadView } from "#/features/admin/components/ThreadView";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/admin/activity/$threadId")({
	component: ActivityThreadRoute,
});

function ActivityThreadRoute() {
	const { threadId } = Route.useParams();
	const navigate = useNavigate();
	const back = () => navigate({ to: "/admin/activity" });
	return (
		<ThreadView
			threadId={threadId}
			backLabel={m.admin_back_threads()}
			onBack={back}
			onDeleted={back}
		/>
	);
}
