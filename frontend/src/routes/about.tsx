import { createFileRoute } from "@tanstack/react-router";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/about")({
	component: About,
});

function About() {
	return (
		<main className="page-wrap px-4 pb-16 pt-20">
			<section className="max-w-3xl">
				<p className="island-kicker mb-3">{m.about_kicker()}</p>
				<h1 className="display-title mb-5 text-4xl font-bold tracking-tight text-[var(--theme-primary)] sm:text-5xl">
					{m.about_title()}
				</h1>
				<p className="mb-4 text-base leading-relaxed text-[var(--theme-secondary)]">
					{m.about_body_1()}
				</p>
				<p className="text-base leading-relaxed text-[var(--theme-secondary)]">
					{m.about_body_2()}
				</p>
			</section>
		</main>
	);
}
