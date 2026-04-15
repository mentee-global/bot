import { m } from "#/paraglide/messages";

export default function Footer() {
	const year = new Date().getFullYear();

	return (
		<footer className="mt-auto border-t border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-6">
			<div className="page-wrap flex flex-col items-center justify-between gap-2 text-center text-xs text-[var(--theme-muted)] sm:flex-row sm:text-left">
				<p className="m-0">{m.footer_rights({ year: String(year) })}</p>
				<p className="m-0">
					<a
						href="https://menteeglobal.org"
						target="_blank"
						rel="noreferrer"
						className="text-[var(--theme-muted)] hover:text-[var(--theme-primary)]"
					>
						menteeglobal.org
					</a>
				</p>
			</div>
		</footer>
	);
}
