/**
 * Admin "Test persona" payload — mirrors the backend's `ChatPersona`
 * (see `backend/app/api/routes/chat.py`). The form is rendered dynamically
 * from the JSON schema returned by `GET /api/admin/persona/schema`, so we
 * intentionally model the payload as a loose `Record<string, unknown>` here
 * — adding a field to the backend's `MenteeProfile` propagates to the form
 * automatically, with no TypeScript change required.
 */
export type PersonaPayload = Record<string, unknown>;

/** Subset of JSON Schema we render. Pydantic emits this shape via
 *  `BaseModel.model_json_schema()`. */
export interface JsonSchema {
	$ref?: string;
	$defs?: Record<string, JsonSchema>;
	type?: string | string[];
	title?: string;
	description?: string;
	enum?: unknown[];
	format?: string;
	default?: unknown;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	anyOf?: JsonSchema[];
	allOf?: JsonSchema[];
	oneOf?: JsonSchema[];
}
