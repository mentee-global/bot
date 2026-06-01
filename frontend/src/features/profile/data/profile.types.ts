/** Mirrors backend ResumeSchema (app/documents/schemas.py). */
export interface Education {
	degree: string;
	institution: string;
	field_of_study: string | null;
	graduation_date: string | null;
	gpa: string | null;
}

export interface WorkExperience {
	company: string;
	position: string;
	start_date: string | null;
	end_date: string | null;
	description: string | null;
}

// A `type` (not `interface`) so it's assignable to the API client's JsonBody
// (Record<string, unknown>) when sent to PUT /api/profile/cv — interfaces
// lack the implicit index signature TS needs for that. Mirrors how
// BudgetConfigPatch is declared.
export type ResumeData = {
	name: string;
	email: string | null;
	phone: string | null;
	location: string | null;
	education: Education[];
	work_experience: WorkExperience[];
	skills: string[];
	certifications: string[] | null;
	languages: string[] | null;
	summary: string | null;
};

/** Mirrors backend ProfileResponse (app/api/routes/profile.py). */
export interface ProfileResponse {
	has_cv: boolean;
	confirmed: boolean;
	cv_structured: ResumeData | null;
	cv_summary: string | null;
	cv_document_id: string | null;
	updated_at: string | null;
}

/** An empty CV used to seed the form on first upload or manual entry. */
export const EMPTY_RESUME: ResumeData = {
	name: "",
	email: null,
	phone: null,
	location: null,
	education: [],
	work_experience: [],
	skills: [],
	certifications: null,
	languages: null,
	summary: null,
};
