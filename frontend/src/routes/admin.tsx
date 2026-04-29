import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import {
	BarChart3,
	Bug,
	ChevronRight,
	ChevronsUpDown,
	Coins,
	LogOut,
	MessageSquare,
	Moon,
	Shield,
	Sun,
	Users as UsersIcon,
	Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Separator } from "#/components/ui/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
} from "#/components/ui/sidebar";
import { AdminShellSkeleton } from "#/features/admin/components/shared";
import { authService } from "#/features/auth/data/auth.service";
import type { User } from "#/features/auth/data/auth.types";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const session = useSession();
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (session.isPending) return;
		if (!session.data) {
			// Round-trip the user through OAuth and land them back on the deep
			// route they were on (e.g. /admin/users/<id>?page=2), not just /admin.
			authService.startLogin({
				redirectTo: location.href || "/admin",
				roleHint: "admin",
			});
			return;
		}
		if (session.data.role !== "admin") {
			// Hide the admin surface from non-admin users. Redirect home rather
			// than rendering an error — mirrors the backend 404 policy.
			navigate({ to: "/" });
		}
	}, [session.isPending, session.data, location.href, navigate]);

	if (session.isPending || !session.data) {
		return <AdminShellSkeleton />;
	}

	if (session.data.role !== "admin") {
		return null;
	}

	return (
		// Pin the admin tree to LTR English regardless of the chat-side locale.
		// The shell + shadcn sidebar/breadcrumb primitives are laid out for LTR
		// and break visually under <html dir="rtl">. A scoped wrapper here
		// overrides the global direction without touching the document root.
		<div dir="ltr" lang="en" className="contents">
			<SidebarProvider className="min-h-[100dvh]">
				<AdminSidebar user={session.data} />
				<SidebarInset className="bg-[var(--theme-bg)]">
					<AdminTopBar />
					<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6 sm:p-8">
						<PageTitle />
						<div className="flex min-h-0 flex-1 flex-col">
							<Outlet />
						</div>
					</div>
				</SidebarInset>
			</SidebarProvider>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const BUDGET_SECTIONS = ["overview", "credits", "pricing", "controls"] as const;
type BudgetSection = (typeof BUDGET_SECTIONS)[number];

function budgetSectionLabel(section: BudgetSection): string {
	if (section === "overview") return "Overview";
	if (section === "credits") return "Credits";
	if (section === "pricing") return "Pricing";
	return "Controls";
}

function AdminSidebar({ user }: { user: User }) {
	const { pathname } = useLocation();
	const currentSection = useCurrentBudgetSection();
	const activityActive = pathname.startsWith("/admin/activity");
	const usersActive = pathname.startsWith("/admin/users");
	const budgetActive = pathname.startsWith("/admin/budget");
	const metricsActive = pathname.startsWith("/admin/metrics");
	const bugReportsActive = pathname.startsWith("/admin/bug-reports");
	const creditRequestsActive = pathname.startsWith("/admin/credit-requests");

	return (
		<Sidebar collapsible="icon" side="left">
			<SidebarHeader className="px-3 py-4">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							className="hover:bg-transparent active:bg-transparent"
							asChild
						>
							<Link to="/admin/activity" aria-label="Admin panel">
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-[var(--theme-accent)] text-[var(--theme-on-accent)]">
									<Shield className="size-4" />
								</div>
								<div className="grid flex-1 text-left leading-tight">
									<span className="island-kicker m-0">Admin</span>
									<span className="truncate text-sm font-semibold">
										Admin panel
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent className="px-2 py-2">
				<SidebarGroup>
					<SidebarGroupLabel>Manage</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								tooltip="Activity"
								isActive={activityActive}
							>
								<Link to="/admin/activity">
									<MessageSquare />
									<span>Activity</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>

						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								tooltip="Users"
								isActive={usersActive}
							>
								<Link to="/admin/users">
									<UsersIcon />
									<span>Users</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>

						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								tooltip="Metrics"
								isActive={metricsActive}
							>
								<Link to="/admin/metrics">
									<BarChart3 />
									<span>Metrics</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>

						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								tooltip="Bug reports"
								isActive={bugReportsActive}
							>
								<Link to="/admin/bug-reports">
									<Bug />
									<span>Bug reports</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>

						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								tooltip="Credit requests"
								isActive={creditRequestsActive}
							>
								<Link to="/admin/credit-requests">
									<Coins />
									<span>Credit requests</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>

						<Collapsible
							asChild
							defaultOpen={budgetActive}
							className="group/collapsible"
						>
							<SidebarMenuItem>
								<CollapsibleTrigger asChild>
									<SidebarMenuButton
										tooltip="Budget"
										isActive={budgetActive}
									>
										<Wallet />
										<span>Budget</span>
										<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
									</SidebarMenuButton>
								</CollapsibleTrigger>
								<CollapsibleContent>
									<SidebarMenuSub>
										{BUDGET_SECTIONS.map((section) => (
											<SidebarMenuSubItem key={section}>
												<SidebarMenuSubButton
													asChild
													isActive={budgetActive && currentSection === section}
												>
													<Link to="/admin/budget" search={{ section }}>
														<span>{budgetSectionLabel(section)}</span>
													</Link>
												</SidebarMenuSubButton>
											</SidebarMenuSubItem>
										))}
									</SidebarMenuSub>
								</CollapsibleContent>
							</SidebarMenuItem>
						</Collapsible>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>

			<SidebarSeparator />
			<SidebarFooter className="px-2 pt-3 pb-5">
				<NavUser user={user} />
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}

// ---------------------------------------------------------------------------
// Footer dropdown — account, theme, language, sign out
// ---------------------------------------------------------------------------

type ThemeMode = "light" | "dark";

function readStoredTheme(): ThemeMode {
	if (typeof window === "undefined") return "light";
	return window.localStorage.getItem("theme") === "dark" ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
	const root = document.documentElement;
	root.classList.remove("light", "dark");
	root.classList.add(mode);
	root.setAttribute("data-theme", mode);
	root.style.colorScheme = mode;
}

function NavUser({ user }: { user: User }) {
	const { isMobile } = useSidebar();
	const logout = useLogoutMutation();
	const [theme, setTheme] = useState<ThemeMode>("light");

	useEffect(() => {
		setTheme(readStoredTheme());
	}, []);

	function selectTheme(next: ThemeMode) {
		setTheme(next);
		applyTheme(next);
		window.localStorage.setItem("theme", next);
	}

	const display = user.name || user.email;
	const ThemeIcon = theme === "dark" ? Moon : Sun;

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<Avatar className="size-8 rounded-lg">
								{user.picture ? (
									<AvatarImage src={user.picture} alt={user.name} />
								) : null}
								<AvatarFallback className="rounded-lg bg-[var(--theme-accent-soft)] text-[var(--theme-primary)]">
									{getInitials(user.name, user.email)}
								</AvatarFallback>
							</Avatar>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{display}</span>
								{user.name ? (
									<span className="truncate text-xs text-muted-foreground">
										{user.email}
									</span>
								) : null}
							</div>
							<ChevronsUpDown className="ml-auto size-4 opacity-60" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>

					<DropdownMenuContent
						className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={8}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<Avatar className="size-8 rounded-lg">
									{user.picture ? (
										<AvatarImage src={user.picture} alt={user.name} />
									) : null}
									<AvatarFallback className="rounded-lg bg-[var(--theme-accent-soft)] text-[var(--theme-primary)]">
										{getInitials(user.name, user.email)}
									</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{display}</span>
									{user.name ? (
										<span className="truncate text-xs text-muted-foreground">
											{user.email}
										</span>
									) : null}
								</div>
							</div>
						</DropdownMenuLabel>

						<DropdownMenuSeparator />

						<DropdownMenuGroup>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<ThemeIcon />
									<span>Theme</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									<DropdownMenuCheckboxItem
										checked={theme === "light"}
										onCheckedChange={(checked) => {
											if (checked) selectTheme("light");
										}}
									>
										<Sun className="mr-2 size-4" />
										Light
									</DropdownMenuCheckboxItem>
									<DropdownMenuCheckboxItem
										checked={theme === "dark"}
										onCheckedChange={(checked) => {
											if (checked) selectTheme("dark");
										}}
									>
										<Moon className="mr-2 size-4" />
										Dark
									</DropdownMenuCheckboxItem>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						</DropdownMenuGroup>

						<DropdownMenuSeparator />

						<DropdownMenuItem onSelect={() => logout.mutate()}>
							<LogOut />
							Sign out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

// ---------------------------------------------------------------------------
// Top bar + breadcrumb + page title
// ---------------------------------------------------------------------------

function AdminTopBar() {
	return (
		<header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-[var(--theme-bg)]/85 px-4 backdrop-blur-sm sm:px-6">
			<SidebarTrigger className="-ml-1" />
			<Separator
				orientation="vertical"
				className="mr-2 data-[orientation=vertical]:h-4"
			/>
			<AdminBreadcrumb />
			<div className="ml-auto flex items-center gap-2">
				<Button asChild variant="outline" size="sm" className="gap-1.5">
					<Link to="/chat">
						<MessageSquare className="size-3.5" />
						<span className="hidden sm:inline">Open chat</span>
					</Link>
				</Button>
			</div>
		</header>
	);
}

function AdminBreadcrumb() {
	const { pathname } = useLocation();
	const currentSection = useCurrentBudgetSection();
	const crumbs = buildCrumbs(pathname, currentSection);

	return (
		<Breadcrumb>
			<BreadcrumbList>
				{crumbs.map((crumb, i) => {
					const isLast = i === crumbs.length - 1;
					const isFirst = i === 0;
					return (
						<span key={crumb.label} className="contents">
							<BreadcrumbItem
								className={isFirst ? "hidden md:block" : undefined}
							>
								{isLast || !crumb.href ? (
									<BreadcrumbPage>{crumb.label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink asChild>
										<Link to={crumb.href} search={crumb.search}>
											{crumb.label}
										</Link>
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
							{!isLast ? (
								<BreadcrumbSeparator
									className={isFirst ? "hidden md:block" : undefined}
								/>
							) : null}
						</span>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

function PageTitle() {
	const { pathname } = useLocation();
	const currentSection = useCurrentBudgetSection();
	const { title, description } = getPageMeta(pathname, currentSection);

	return (
		<div className="flex flex-col gap-1">
			<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
				{title}
			</h1>
			{description ? (
				<p className="text-sm text-muted-foreground">{description}</p>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Crumb = {
	label: string;
	href?: string;
	search?: Record<string, string>;
};

function buildCrumbs(pathname: string, section: BudgetSection): Crumb[] {
	const root: Crumb = {
		label: "Admin",
		href: "/admin/activity",
	};

	if (pathname.startsWith("/admin/activity")) {
		const rest = pathname.slice("/admin/activity".length).replace(/^\//, "");
		const crumbs: Crumb[] = [
			root,
			{
				label: "Activity",
				href: rest ? "/admin/activity" : undefined,
			},
		];
		if (rest) {
			crumbs.push({ label: shortenId(rest) });
		}
		return crumbs;
	}

	if (pathname.startsWith("/admin/users")) {
		return [root, { label: "Users" }];
	}

	if (pathname.startsWith("/admin/metrics")) {
		return [root, { label: "Metrics" }];
	}

	if (pathname.startsWith("/admin/bug-reports")) {
		return [root, { label: "Bug reports" }];
	}

	if (pathname.startsWith("/admin/credit-requests")) {
		return [root, { label: "Credit requests" }];
	}

	if (pathname.startsWith("/admin/budget")) {
		return [
			root,
			{ label: "Budget", href: "/admin/budget" },
			{ label: budgetSectionLabel(section) },
		];
	}

	return [root];
}

function getPageMeta(
	pathname: string,
	section: BudgetSection,
): { title: string; description?: string } {
	if (pathname.startsWith("/admin/activity")) {
		const rest = pathname.slice("/admin/activity".length).replace(/^\//, "");
		if (rest) {
			return { title: "Conversation" };
		}
		return { title: "Activity" };
	}
	if (pathname.startsWith("/admin/users")) {
		return { title: "Users" };
	}
	if (pathname.startsWith("/admin/metrics")) {
		return {
			title: "Metrics",
			description: "Activity over the selected window. All counts are UTC-day buckets.",
		};
	}
	if (pathname.startsWith("/admin/bug-reports")) {
		return {
			title: "Bug reports",
			description: "User-submitted bug reports. New reports email juan@ and letitia@.",
		};
	}
	if (pathname.startsWith("/admin/credit-requests")) {
		return {
			title: "Credit requests",
			description: "Users asking for more credits. Grant from here to update their quota.",
		};
	}
	if (pathname.startsWith("/admin/budget")) {
		return {
			title: "Budget",
			description: budgetSectionLabel(section),
		};
	}
	return { title: "Admin panel" };
}

function useCurrentBudgetSection(): BudgetSection {
	return useRouterState({
		select: (state) => {
			const search = state.location.search as { section?: unknown };
			const raw = search?.section;
			return typeof raw === "string" &&
				(BUDGET_SECTIONS as readonly string[]).includes(raw)
				? (raw as BudgetSection)
				: "overview";
		},
	});
}

function shortenId(id: string): string {
	if (id.length <= 10) return id;
	return `${id.slice(0, 6)}…${id.slice(-3)}`;
}

function getInitials(name: string | undefined, email: string): string {
	const source = name?.trim() || email;
	const parts = source.split(/[\s@.]+/).filter(Boolean);
	const first = parts[0]?.[0] ?? "A";
	const second = parts[1]?.[0] ?? "";
	return (first + second).toUpperCase();
}
