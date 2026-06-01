import type { User } from "#/features/auth/data/auth.types";
import { m } from "#/paraglide/messages";

/** Read-only display of the profile Mentee's platform shares over OAuth.
 * The mentee edits this on menteeglobal.org, not here — we only surface it so
 * they can see what context the bot already has. The editable CV lives below. */
export function MenteeProfilePanel({ user }: { user: User }) {
	const p = user.mentee_profile ?? null;

	const where = [p?.location, p?.country].filter(Boolean).join(", ");
	const rows: Array<{ label: string; value: string | null }> = [
		{ label: m.profile_field_name(), value: user.name || null },
		{ label: m.profile_field_email(), value: user.email || null },
		{ label: m.profile_field_location(), value: where || null },
		{ label: m.mentee_field_age(), value: p?.age ?? null },
		{ label: m.mentee_field_gender(), value: p?.gender ?? null },
		{
			label: m.mentee_field_education_level(),
			value: p?.education_level ?? null,
		},
		{
			label: m.mentee_field_socially_engaged(),
			value:
				p?.socially_engaged == null
					? null
					: p.socially_engaged
						? m.mentee_yes()
						: m.mentee_no(),
		},
		{
			label: m.mentee_field_organization(),
			value: p?.organization?.name ?? null,
		},
		{
			label: m.mentee_field_mentor(),
			value: p?.mentor
				? [p.mentor.name, p.mentor.professional_title]
						.filter(Boolean)
						.join(" · ")
				: null,
		},
	];

	const chips: Array<{ label: string; items: string[] }> = [
		{ label: m.mentee_field_languages(), items: p?.languages ?? [] },
		{ label: m.mentee_field_interests(), items: p?.interests ?? [] },
		{ label: m.mentee_field_topics(), items: p?.topics ?? [] },
		{ label: m.mentee_field_work_state(), items: p?.work_state ?? [] },
		{
			label: m.mentee_field_immigrant_status(),
			items: p?.immigrant_status ?? [],
		},
	];

	const visibleRows = rows.filter((r) => r.value);
	const visibleChips = chips.filter((c) => c.items.length > 0);
	const education = p?.education ?? [];
	const isEmpty =
		!visibleRows.length &&
		!visibleChips.length &&
		!education.length &&
		!p?.biography &&
		!p?.application_notes;

	return (
		<section className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5">
			<h2 className="text-sm font-semibold text-[var(--theme-primary)]">
				{m.mentee_profile_heading()}
			</h2>
			<p className="mt-0.5 mb-4 text-xs text-[var(--theme-muted)]">
				{m.mentee_profile_subtitle()}
			</p>

			{isEmpty ? (
				<p className="text-sm text-[var(--theme-muted)]">
					{m.mentee_profile_empty()}
				</p>
			) : (
				<div className="flex flex-col gap-4">
					{visibleRows.length ? (
						<dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
							{visibleRows.map((r) => (
								<div key={r.label} className="flex flex-col">
									<dt className="text-xs text-[var(--theme-muted)]">
										{r.label}
									</dt>
									<dd className="text-sm text-[var(--theme-secondary)]">
										{r.value}
									</dd>
								</div>
							))}
						</dl>
					) : null}

					{visibleChips.map((c) => (
						<div key={c.label} className="flex flex-col gap-1">
							<span className="text-xs text-[var(--theme-muted)]">
								{c.label}
							</span>
							<div className="flex flex-wrap gap-1.5">
								{c.items.map((item) => (
									<span
										key={item}
										className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-0.5 text-xs text-[var(--theme-secondary)]"
									>
										{item}
									</span>
								))}
							</div>
						</div>
					))}

					{education.length ? (
						<div className="flex flex-col gap-1.5">
							<span className="text-xs text-[var(--theme-muted)]">
								{m.profile_section_education()}
							</span>
							{education.map((e) => (
								<p
									key={`${e.level}-${e.school}`}
									className="text-sm text-[var(--theme-secondary)]"
								>
									{[
										e.level,
										e.majors.length ? e.majors.join(", ") : null,
										e.school,
										e.graduation_year,
									]
										.filter(Boolean)
										.join(" · ")}
								</p>
							))}
						</div>
					) : null}

					{p?.biography ? (
						<Block label={m.mentee_field_biography()} text={p.biography} />
					) : null}
					{p?.application_notes ? (
						<Block
							label={m.mentee_field_application_notes()}
							text={p.application_notes}
						/>
					) : null}
				</div>
			)}
		</section>
	);
}

function Block({ label, text }: { label: string; text: string }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs text-[var(--theme-muted)]">{label}</span>
			<p className="whitespace-pre-line text-sm text-[var(--theme-secondary)]">
				{text}
			</p>
		</div>
	);
}
