import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { LoginRedirectOverlay } from "#/features/auth/components/LoginRedirectOverlay";
import { authService } from "#/features/auth/data/auth.service";
import { useSession } from "#/features/auth/hooks/useSession";
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
		requestAnimationFrame(() => authService.startLogin());
	};

	const features = [
		{
			title: m.landing_feature_scholarships_title(),
			desc: m.landing_feature_scholarships_desc(),
		},
		{
			title: m.landing_feature_paths_title(),
			desc: m.landing_feature_paths_desc(),
		},
		{
			title: m.landing_feature_career_title(),
			desc: m.landing_feature_career_desc(),
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
						<Link to="/chat" className="btn-primary">
							{m.landing_cta_goto_chat()} <ArrowRight size={16} />
						</Link>
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

			<section className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-border)] sm:grid-cols-3">
				{features.map(({ title, desc }) => (
					<article
						key={title}
						className="flex flex-col gap-2 bg-[var(--theme-bg)] p-6"
					>
						<h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
							{title}
						</h2>
						<p className="m-0 text-sm leading-relaxed text-[var(--theme-secondary)]">
							{desc}
						</p>
					</article>
				))}
			</section>
			{isRedirecting && <LoginRedirectOverlay />}
		</main>
	);
}
