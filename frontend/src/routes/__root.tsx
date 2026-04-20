import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ArrowLeft } from "lucide-react";
import Footer from "#/components/Footer";
import Header from "#/components/Header";
import PostHogProvider from "#/integrations/posthog/provider";
import TanStackQueryDevtools from "#/integrations/tanstack-query/devtools";
import { m } from "#/paraglide/messages";
import { getLocale, locales, localizeHref } from "#/paraglide/runtime";
import appCss from "#/styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

// Right-to-left scripts. Extend this set if you add locales that need RTL
// layout (e.g. Persian "fa", Urdu "ur").
const RTL_LOCALES = new Set<string>(["ar", "he"]);

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=stored==='dark'?'dark':'light';var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(mode);root.setAttribute('data-theme',mode);root.style.colorScheme=mode;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: ({ matches }) => {
		// Router `rewrite.input` delocalizes the URL before matching, so the
		// leaf match's pathname is the canonical (unprefixed) route. We map it
		// back through `localizeHref` once per locale to produce hreflang
		// alternates that Google can use to serve the right language variant.
		const leafPath = matches.at(-1)?.pathname ?? "/";
		const alternateLinks = locales.map((locale) => ({
			rel: "alternate",
			hrefLang: locale,
			href: localizeHref(leafPath, { locale }),
		}));

		return {
			meta: [
				{ charSet: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
				{ title: m.meta_title() },
				{ name: "description", content: m.meta_description() },
			],
			links: [
				{ rel: "stylesheet", href: appCss },
				{ rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
				...alternateLinks,
				{ rel: "alternate", hrefLang: "x-default", href: leafPath },
			],
		};
	},
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

function NotFound() {
	return (
		<main className="page-wrap flex flex-1 flex-col items-start justify-center px-4 pb-16 pt-20">
			<p className="island-kicker mb-4">{m.notfound_kicker()}</p>
			<h1 className="display-title mb-6 max-w-2xl text-5xl font-bold leading-[1.05] tracking-tight text-[var(--theme-primary)] sm:text-6xl">
				{m.notfound_title()}
			</h1>
			<p className="mb-10 max-w-xl text-base leading-relaxed text-[var(--theme-secondary)] sm:text-lg">
				{m.notfound_body()}
			</p>
			<Link to="/" className="btn-primary">
				<ArrowLeft size={16} /> {m.notfound_back_home()}
			</Link>
		</main>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const locale = getLocale();
	const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: pre-hydration theme script, static content, prevents FOUC */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body
				className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[var(--theme-accent-soft)]"
				suppressHydrationWarning
			>
				<PostHogProvider>
					<div className="flex min-h-[100dvh] flex-col">
						<Header />
						<div className="flex flex-1 flex-col">{children}</div>
						<Footer />
					</div>
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							TanStackQueryDevtools,
						]}
					/>
				</PostHogProvider>
				<Scripts />
			</body>
		</html>
	);
}
