import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { LoginRedirectOverlay } from "#/features/auth/components/LoginRedirectOverlay";
import { authService } from "#/features/auth/data/auth.service";
import { useSession } from "#/features/auth/hooks/useSession";
import { BugReportTrigger } from "#/features/reports/components/BugReportTrigger";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
	const session = useSession();
	const isLoggedIn = !!session.data;
	const [isRedirecting, setIsRedirecting] = useState(false);

	const handleLogin = () => {
		if (isRedirecting) return;
		setIsRedirecting(true);
		// Defer the full-page redirect one frame so the overlay paints before
		// the browser starts tearing down this document.
		requestAnimationFrame(() =>
			authService.startLogin({ roleHint: "mentee" }),
		);
	};

	const features = [
		{
			title: m.landing_feature_scholarships_title(),
			desc: m.landing_feature_scholarships_desc(),
		},
		{
			title: m.landing_feature_study_abroad_title(),
			desc: m.landing_feature_study_abroad_desc(),
		},
		{
			title: m.landing_feature_career_title(),
			desc: m.landing_feature_career_desc(),
		},
		{
			title: m.landing_feature_visa_title(),
			desc: m.landing_feature_visa_desc(),
		},
	];

	const expectations = [
		{
			title: m.landing_expect_sources_title(),
			desc: m.landing_expect_sources_desc(),
		},
		{
			title: m.landing_expect_scope_title(),
			desc: m.landing_expect_scope_desc(),
		},
		{
			title: m.landing_expect_access_title(),
			desc: m.landing_expect_access_desc(),
		},
	];

	return (
		<main className="page-wrap px-4 pb-16 pt-20">
			<section className="rise-in max-w-3xl">
				<p className="island-kicker mb-4">{m.landing_kicker()}</p>
				<h1 className="display-title mb-6 text-5xl font-bold leading-[1.05] tracking-tight text-[var(--theme-primary)] sm:text-6xl">
					{m.landing_title()}
				</h1>
				<p className="mb-10 max-w-2xl text-base leading-relaxed text-[var(--theme-secondary)] sm:text-lg">
					{m.landing_subtitle()}
				</p>
				<div className="flex flex-wrap gap-3">
					{isLoggedIn ? (
						session.data?.role === "admin" ? (
							<Link to="/admin" className="btn-primary">
								{m.landing_cta_goto_admin()} <ArrowRight size={16} />
							</Link>
						) : (
							<Link to="/chat" className="btn-primary">
								{m.landing_cta_goto_chat()} <ArrowRight size={16} />
							</Link>
						)
					) : (
						<button
							type="button"
							onClick={handleLogin}
							disabled={isRedirecting}
							aria-busy={isRedirecting}
							className="btn-primary"
						>
							{isRedirecting
								? m.landing_cta_signin_pending()
								: m.landing_cta_signin()}{" "}
							<ArrowRight size={16} />
						</button>
					)}
				</div>
			</section>

			<section className="mt-20">
				<h2 className="island-kicker mb-6">{m.landing_help_heading()}</h2>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{features.map(({ title, desc }) => (
						<article
							key={title}
							className="surface-card flex flex-col gap-2 p-5"
						>
							<h3 className="m-0 text-sm font-semibold text-[var(--theme-primary)]">
								{title}
							</h3>
							<p className="m-0 text-sm leading-relaxed text-[var(--theme-secondary)]">
								{desc}
							</p>
						</article>
					))}
				</div>
			</section>

			<section className="mt-16">
				<h2 className="island-kicker mb-6">{m.landing_expect_heading()}</h2>
				<div className="grid gap-6 sm:grid-cols-3">
					{expectations.map(({ title, desc }) => (
						<div
							key={title}
							className="flex flex-col gap-2 border-t border-[var(--theme-border)] pt-4"
						>
							<h3 className="m-0 text-sm font-semibold text-[var(--theme-primary)]">
								{title}
							</h3>
							<p className="m-0 text-sm leading-relaxed text-[var(--theme-secondary)]">
								{desc}
							</p>
						</div>
					))}
				</div>
			</section>

			<section className="mt-16 max-w-2xl">
				<h2 className="island-kicker mb-4">{m.landing_about_heading()}</h2>
				<p className="m-0 text-sm leading-relaxed text-[var(--theme-secondary)] sm:text-base">
					{m.landing_about_body()}{" "}
					<a
						href="https://menteeglobal.org"
						target="_blank"
						rel="noreferrer"
						className="text-[var(--theme-secondary)] underline underline-offset-4 hover:text-[var(--theme-primary)]"
					>
						{m.landing_about_link_text()}
					</a>
					.
				</p>
			</section>

			<div className="mt-16 flex justify-start border-t border-[var(--theme-border)] pt-6">
				<BugReportTrigger user={session.data ?? null} variant="link" />
			</div>

			{isRedirecting && <LoginRedirectOverlay />}
		</main>
	);
}
