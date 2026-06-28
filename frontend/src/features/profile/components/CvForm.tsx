import { Plus, Trash2 } from "lucide-react";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import type {
	Education,
	ResumeData,
	WorkExperience,
} from "#/features/profile/data/profile.types";
import { m } from "#/paraglide/messages";

interface CvFormProps {
	value: ResumeData;
	onChange: (next: ResumeData) => void;
}

/** Comma-separated list <-> string[] helpers for the skills/languages fields. */
function listToText(list: string[] | null): string {
	return (list ?? []).join(", ");
}
function textToList(text: string): string[] {
	return text
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as `children` and rendered inside the label (valid implicit association); the rule can't see through the prop
		<label className="flex flex-col gap-1.5 text-sm">
			<span className="font-medium text-[var(--theme-secondary)]">{label}</span>
			{children}
		</label>
	);
}

const EMPTY_EDU: Education = {
	degree: "",
	institution: "",
	field_of_study: null,
	graduation_date: null,
	gpa: null,
};
const EMPTY_WORK: WorkExperience = {
	company: "",
	position: "",
	start_date: null,
	end_date: null,
	description: null,
};

export function CvForm({ value, onChange }: CvFormProps) {
	const set = (patch: Partial<ResumeData>) => onChange({ ...value, ...patch });

	const setEdu = (i: number, patch: Partial<Education>) => {
		const education = value.education.map((e, idx) =>
			idx === i ? { ...e, ...patch } : e,
		);
		set({ education });
	};
	const setWork = (i: number, patch: Partial<WorkExperience>) => {
		const work_experience = value.work_experience.map((w, idx) =>
			idx === i ? { ...w, ...patch } : w,
		);
		set({ work_experience });
	};

	return (
		<div className="flex flex-col gap-6">
			{/* Identity */}
			<section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field label={m.profile_field_name()}>
					<Input
						value={value.name}
						onChange={(e) => set({ name: e.target.value })}
						required
					/>
				</Field>
				<Field label={m.profile_field_location()}>
					<Input
						value={value.location ?? ""}
						onChange={(e) => set({ location: e.target.value || null })}
					/>
				</Field>
				<Field label={m.profile_field_email()}>
					<Input
						type="email"
						value={value.email ?? ""}
						onChange={(e) => set({ email: e.target.value || null })}
					/>
				</Field>
				<Field label={m.profile_field_phone()}>
					<Input
						value={value.phone ?? ""}
						onChange={(e) => set({ phone: e.target.value || null })}
					/>
				</Field>
			</section>

			<Field label={m.profile_field_summary()}>
				<Textarea
					rows={3}
					value={value.summary ?? ""}
					onChange={(e) => set({ summary: e.target.value || null })}
				/>
			</Field>

			{/* Work experience */}
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold text-[var(--theme-primary)]">
						{m.profile_section_experience()}
					</h2>
					<button
						type="button"
						className="btn-secondary inline-flex items-center gap-1 text-xs"
						onClick={() =>
							set({
								work_experience: [...value.work_experience, { ...EMPTY_WORK }],
							})
						}
					>
						<Plus className="size-3.5" /> {m.profile_add()}
					</button>
				</div>
				{value.work_experience.map((w, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional + reorderable only via add/remove
						key={i}
						className="rounded-lg border border-[var(--theme-border)] p-3"
					>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Field label={m.profile_field_position()}>
								<Input
									value={w.position}
									onChange={(e) => setWork(i, { position: e.target.value })}
								/>
							</Field>
							<Field label={m.profile_field_company()}>
								<Input
									value={w.company}
									onChange={(e) => setWork(i, { company: e.target.value })}
								/>
							</Field>
							<Field label={m.profile_field_start()}>
								<Input
									value={w.start_date ?? ""}
									onChange={(e) =>
										setWork(i, { start_date: e.target.value || null })
									}
								/>
							</Field>
							<Field label={m.profile_field_end()}>
								<Input
									value={w.end_date ?? ""}
									onChange={(e) =>
										setWork(i, { end_date: e.target.value || null })
									}
								/>
							</Field>
						</div>
						<div className="mt-3">
							<Field label={m.profile_field_description()}>
								<Textarea
									rows={2}
									value={w.description ?? ""}
									onChange={(e) =>
										setWork(i, { description: e.target.value || null })
									}
								/>
							</Field>
						</div>
						<button
							type="button"
							className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--theme-muted)] transition hover:text-[var(--theme-danger)]"
							onClick={() =>
								set({
									work_experience: value.work_experience.filter(
										(_, idx) => idx !== i,
									),
								})
							}
						>
							<Trash2 className="size-3.5" /> {m.profile_remove()}
						</button>
					</div>
				))}
			</section>

			{/* Education */}
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold text-[var(--theme-primary)]">
						{m.profile_section_education()}
					</h2>
					<button
						type="button"
						className="btn-secondary inline-flex items-center gap-1 text-xs"
						onClick={() =>
							set({ education: [...value.education, { ...EMPTY_EDU }] })
						}
					>
						<Plus className="size-3.5" /> {m.profile_add()}
					</button>
				</div>
				{value.education.map((edu, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional + reorderable only via add/remove
						key={i}
						className="rounded-lg border border-[var(--theme-border)] p-3"
					>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Field label={m.profile_field_degree()}>
								<Input
									value={edu.degree}
									onChange={(e) => setEdu(i, { degree: e.target.value })}
								/>
							</Field>
							<Field label={m.profile_field_institution()}>
								<Input
									value={edu.institution}
									onChange={(e) => setEdu(i, { institution: e.target.value })}
								/>
							</Field>
							<Field label={m.profile_field_field_of_study()}>
								<Input
									value={edu.field_of_study ?? ""}
									onChange={(e) =>
										setEdu(i, { field_of_study: e.target.value || null })
									}
								/>
							</Field>
							<Field label={m.profile_field_graduation()}>
								<Input
									value={edu.graduation_date ?? ""}
									onChange={(e) =>
										setEdu(i, { graduation_date: e.target.value || null })
									}
								/>
							</Field>
						</div>
						<button
							type="button"
							className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--theme-muted)] transition hover:text-[var(--theme-danger)]"
							onClick={() =>
								set({
									education: value.education.filter((_, idx) => idx !== i),
								})
							}
						>
							<Trash2 className="size-3.5" /> {m.profile_remove()}
						</button>
					</div>
				))}
			</section>

			{/* Lists */}
			<Field label={m.profile_field_skills()}>
				<Input
					value={listToText(value.skills)}
					onChange={(e) => set({ skills: textToList(e.target.value) })}
					placeholder={m.profile_list_placeholder()}
				/>
			</Field>
			<Field label={m.profile_field_languages()}>
				<Input
					value={listToText(value.languages)}
					onChange={(e) => {
						const list = textToList(e.target.value);
						set({ languages: list.length ? list : null });
					}}
					placeholder={m.profile_list_placeholder()}
				/>
			</Field>
			<Field label={m.profile_field_certifications()}>
				<Input
					value={listToText(value.certifications)}
					onChange={(e) => {
						const list = textToList(e.target.value);
						set({ certifications: list.length ? list : null });
					}}
					placeholder={m.profile_list_placeholder()}
				/>
			</Field>
		</div>
	);
}
