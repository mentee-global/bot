import type { SelectOption } from "#/components/ui/searchable-select";

/**
 * Curated option lists for the persona form's searchable selects.
 *
 * Timezones come from the browser's IANA database via `Intl.supportedValuesOf`
 * (~420 zones, kept in sync with the JS engine). Languages and countries are
 * shipped as a curated list — there's no equivalent built-in, and shipping
 * the full ISO list (~7k languages, ~250 countries) would dwarf the form.
 *
 * The hint shows the underlying value (timezone name, BCP 47 code, ISO code)
 * so admins can paste/diff against what Mentee's API returns.
 */

let cachedTimezones: SelectOption[] | null = null;

export function getTimezoneOptions(): SelectOption[] {
	if (cachedTimezones) return cachedTimezones;
	let zones: string[];
	try {
		const supported =
			"supportedValuesOf" in Intl
				? (
						Intl as unknown as {
							supportedValuesOf: (k: string) => string[];
						}
					).supportedValuesOf("timeZone")
				: null;
		zones = supported ?? FALLBACK_TIMEZONES;
	} catch {
		zones = FALLBACK_TIMEZONES;
	}
	cachedTimezones = zones.map((tz) => ({
		value: tz,
		label: tz.replace(/_/g, " "),
		hint: tz,
	}));
	return cachedTimezones;
}

const FALLBACK_TIMEZONES = [
	"UTC",
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/Mexico_City",
	"America/Sao_Paulo",
	"America/Bogota",
	"America/Buenos_Aires",
	"Europe/London",
	"Europe/Paris",
	"Europe/Berlin",
	"Europe/Madrid",
	"Europe/Rome",
	"Africa/Cairo",
	"Africa/Lagos",
	"Asia/Dubai",
	"Asia/Karachi",
	"Asia/Kolkata",
	"Asia/Singapore",
	"Asia/Tokyo",
	"Asia/Seoul",
	"Asia/Shanghai",
	"Australia/Sydney",
	"Pacific/Auckland",
];

const LANGUAGE_CODES: { code: string; english: string }[] = [
	{ code: "en", english: "English" },
	{ code: "es", english: "Spanish" },
	{ code: "fr", english: "French" },
	{ code: "pt", english: "Portuguese" },
	{ code: "de", english: "German" },
	{ code: "it", english: "Italian" },
	{ code: "nl", english: "Dutch" },
	{ code: "ru", english: "Russian" },
	{ code: "uk", english: "Ukrainian" },
	{ code: "pl", english: "Polish" },
	{ code: "tr", english: "Turkish" },
	{ code: "ar", english: "Arabic" },
	{ code: "fa", english: "Persian" },
	{ code: "he", english: "Hebrew" },
	{ code: "hi", english: "Hindi" },
	{ code: "bn", english: "Bengali" },
	{ code: "ur", english: "Urdu" },
	{ code: "id", english: "Indonesian" },
	{ code: "ms", english: "Malay" },
	{ code: "th", english: "Thai" },
	{ code: "vi", english: "Vietnamese" },
	{ code: "tl", english: "Tagalog" },
	{ code: "zh", english: "Chinese" },
	{ code: "ja", english: "Japanese" },
	{ code: "ko", english: "Korean" },
	{ code: "sw", english: "Swahili" },
	{ code: "am", english: "Amharic" },
	{ code: "yo", english: "Yoruba" },
	{ code: "ig", english: "Igbo" },
	{ code: "ha", english: "Hausa" },
	{ code: "zu", english: "Zulu" },
];

let cachedLanguages: SelectOption[] | null = null;

export function getLanguageOptions(): SelectOption[] {
	if (cachedLanguages) return cachedLanguages;
	let displayNames: Intl.DisplayNames | null = null;
	try {
		displayNames = new Intl.DisplayNames(["en"], { type: "language" });
	} catch {
		displayNames = null;
	}
	cachedLanguages = LANGUAGE_CODES.map(({ code, english }) => {
		const native = displayNames?.of(code);
		return {
			value: code,
			label: native ?? english,
			hint: code.toUpperCase(),
		};
	});
	return cachedLanguages;
}

// ISO 3166-1 alpha-2 — common subset. Mentee's profile uses country names or
// codes inconsistently across regions, so we accept both: the value is the
// label string (what the agent sees) and the hint shows the code.
const COUNTRY_LIST: { code: string; name: string }[] = [
	{ code: "AR", name: "Argentina" },
	{ code: "AU", name: "Australia" },
	{ code: "BD", name: "Bangladesh" },
	{ code: "BE", name: "Belgium" },
	{ code: "BO", name: "Bolivia" },
	{ code: "BR", name: "Brazil" },
	{ code: "CA", name: "Canada" },
	{ code: "CL", name: "Chile" },
	{ code: "CN", name: "China" },
	{ code: "CO", name: "Colombia" },
	{ code: "CR", name: "Costa Rica" },
	{ code: "CU", name: "Cuba" },
	{ code: "DO", name: "Dominican Republic" },
	{ code: "EC", name: "Ecuador" },
	{ code: "EG", name: "Egypt" },
	{ code: "SV", name: "El Salvador" },
	{ code: "ET", name: "Ethiopia" },
	{ code: "FR", name: "France" },
	{ code: "DE", name: "Germany" },
	{ code: "GH", name: "Ghana" },
	{ code: "GT", name: "Guatemala" },
	{ code: "HN", name: "Honduras" },
	{ code: "IN", name: "India" },
	{ code: "ID", name: "Indonesia" },
	{ code: "IR", name: "Iran" },
	{ code: "IQ", name: "Iraq" },
	{ code: "IE", name: "Ireland" },
	{ code: "IL", name: "Israel" },
	{ code: "IT", name: "Italy" },
	{ code: "JM", name: "Jamaica" },
	{ code: "JP", name: "Japan" },
	{ code: "JO", name: "Jordan" },
	{ code: "KE", name: "Kenya" },
	{ code: "KR", name: "South Korea" },
	{ code: "LB", name: "Lebanon" },
	{ code: "MX", name: "Mexico" },
	{ code: "MA", name: "Morocco" },
	{ code: "NL", name: "Netherlands" },
	{ code: "NZ", name: "New Zealand" },
	{ code: "NI", name: "Nicaragua" },
	{ code: "NG", name: "Nigeria" },
	{ code: "PK", name: "Pakistan" },
	{ code: "PA", name: "Panama" },
	{ code: "PY", name: "Paraguay" },
	{ code: "PE", name: "Peru" },
	{ code: "PH", name: "Philippines" },
	{ code: "PL", name: "Poland" },
	{ code: "PT", name: "Portugal" },
	{ code: "PR", name: "Puerto Rico" },
	{ code: "RU", name: "Russia" },
	{ code: "SA", name: "Saudi Arabia" },
	{ code: "SG", name: "Singapore" },
	{ code: "ZA", name: "South Africa" },
	{ code: "ES", name: "Spain" },
	{ code: "SE", name: "Sweden" },
	{ code: "CH", name: "Switzerland" },
	{ code: "SY", name: "Syria" },
	{ code: "TW", name: "Taiwan" },
	{ code: "TH", name: "Thailand" },
	{ code: "TR", name: "Turkey" },
	{ code: "UG", name: "Uganda" },
	{ code: "UA", name: "Ukraine" },
	{ code: "AE", name: "United Arab Emirates" },
	{ code: "GB", name: "United Kingdom" },
	{ code: "US", name: "United States" },
	{ code: "UY", name: "Uruguay" },
	{ code: "VE", name: "Venezuela" },
	{ code: "VN", name: "Vietnam" },
];

let cachedCountries: SelectOption[] | null = null;

export function getCountryOptions(): SelectOption[] {
	if (cachedCountries) return cachedCountries;
	cachedCountries = COUNTRY_LIST.map(({ code, name }) => ({
		value: name,
		label: name,
		hint: code,
	}));
	return cachedCountries;
}

const ROLE_OPTIONS: SelectOption[] = [
	{ value: "mentee", label: "Mentee" },
	{ value: "mentor", label: "Mentor" },
	{ value: "admin", label: "Admin" },
	{ value: "staff", label: "Staff" },
];

export function getRoleOptions(): SelectOption[] {
	return ROLE_OPTIONS;
}

const GENDER_OPTIONS: SelectOption[] = [
	{ value: "female", label: "Female" },
	{ value: "male", label: "Male" },
	{ value: "non-binary", label: "Non-binary" },
	{ value: "prefer-not-to-say", label: "Prefer not to say" },
];

export function getGenderOptions(): SelectOption[] {
	return GENDER_OPTIONS;
}

const EDUCATION_LEVEL_OPTIONS: SelectOption[] = [
	{ value: "primary", label: "Primary" },
	{ value: "secondary", label: "Secondary / High school" },
	{ value: "associate", label: "Associate" },
	{ value: "bachelors", label: "Bachelor's" },
	{ value: "masters", label: "Master's" },
	{ value: "doctorate", label: "Doctorate / PhD" },
	{ value: "vocational", label: "Vocational / technical" },
	{ value: "other", label: "Other" },
];

export function getEducationLevelOptions(): SelectOption[] {
	return EDUCATION_LEVEL_OPTIONS;
}
