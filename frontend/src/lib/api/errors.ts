/**
 * Structured error from `api.*`. Surfaces the FastAPI body in a shape the
 * admin UI can render: status, detail message, and (in non-prod) exception
 * type + a short traceback. The `body` is kept around for components that
 * want to render the raw payload.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly body: unknown;
	readonly detail: string | null;
	readonly exceptionType: string | null;
	readonly trace: string | null;
	readonly path: string | null;

	constructor(status: number, body: unknown) {
		const parsed = parseBody(body);
		super(parsed.detail ?? `Request failed with status ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
		this.detail = parsed.detail;
		this.exceptionType = parsed.exceptionType;
		this.trace = parsed.trace;
		this.path = parsed.path;
	}
}

interface ParsedErrorBody {
	detail: string | null;
	exceptionType: string | null;
	trace: string | null;
	path: string | null;
}

function parseBody(body: unknown): ParsedErrorBody {
	const empty: ParsedErrorBody = {
		detail: null,
		exceptionType: null,
		trace: null,
		path: null,
	};
	if (body == null || typeof body !== "object") return empty;
	const b = body as Record<string, unknown>;
	const detail = pickString(b.detail) ?? pickString(b.message);
	const exceptionType = pickString(b.type);
	const trace = pickString(b.trace);
	const path = pickString(b.path);
	return { detail, exceptionType, trace, path };
}

function pickString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
