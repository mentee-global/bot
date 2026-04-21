import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useEffect } from "react";
import { Button } from "#/components/ui/button";
import { AdminShellSkeleton } from "#/features/admin/components/shared";
import { authService } from "#/features/auth/data/auth.service";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const session = useSession();
	const navigate = useNavigate();

	useEffect(() => {
		if (session.isPending) return;
		if (!session.data) {
			// Kick off an admin-hinted login; Mentee shows its /admin login form,
			// backend stashes redirect_to=/admin and lands us back here after auth.
			authService.startLogin({ redirectTo: "/admin", roleHint: "admin" });
			return;
		}
		if (session.data.role !== "admin") {
			// Hide the admin surface from non-admin users. Redirect home rather
			// than rendering an error — mirrors the backend 404 policy.
			navigate({ to: "/" });
		}
	}, [session.isPending, session.data, navigate]);

	if (session.isPending || !session.data) {
		return <AdminShellSkeleton />;
	}

	if (session.data.role !== "admin") {
		return null;
	}

	return (
		<main className="page-wrap min-w-0 px-3 py-5 sm:px-6 sm:py-10">
			<AdminHeader />
			<AdminNav />
			<div className="mt-5 sm:mt-6">
				<Outlet />
			</div>
		</main>
	);
}

function AdminHeader() {
	const session = useSession();
	const logout = useLogoutMutation();
	const displayName = session.data?.name || session.data?.email || "";

	return (
		<header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
			<div className="min-w-0 flex-1">
				<p className="island-kicker m-0">{m.admin_kicker()}</p>
				<h1 className="m-0 text-xl font-semibold sm:text-2xl">
					{m.admin_title()}
				</h1>
				{displayName ? (
					<p className="m-0 mt-1 truncate text-sm text-muted-foreground">
						{m.admin_signed_in_as({ name: displayName })}
					</p>
				) : null}
			</div>
			<Button
				variant="outline"
				size="sm"
				onClick={() => logout.mutate()}
				className="shrink-0 gap-1.5"
			>
				<LogOut className="size-3.5" />
				{m.admin_sign_out()}
			</Button>
		</header>
	);
}

function AdminNav() {
	const { pathname } = useLocation();
	const items = [
		{ to: "/admin/activity", label: m.admin_tab_activity() },
		{ to: "/admin/users", label: m.admin_tab_users() },
	] as const;

	return (
		<nav className="mt-4 flex gap-1 border-b" aria-label="Admin sections">
			{items.map((item) => {
				const active = pathname.startsWith(item.to);
				return (
					<Link
						key={item.to}
						to={item.to}
						className={cn(
							"-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
							active
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
