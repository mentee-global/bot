import { ApiError } from "#/lib/api/errors";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8001";

type JsonBody = Record<string, unknown> | unknown[];

interface RequestOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: JsonBody;
	signal?: AbortSignal;
	headers?: Record<string, string>;
}

async function request<T>(
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const { method = "GET", body, signal, headers: extraHeaders } = options;

	const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
	if (body) headers["Content-Type"] = "application/json";

	const response = await fetch(`${API_URL}${path}`, {
		method,
		credentials: "include",
		headers: Object.keys(headers).length ? headers : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal,
	});

	if (!response.ok) {
		let parsed: unknown = null;
		try {
			parsed = await response.json();
		} catch {
			// body wasn't JSON — keep parsed as null
		}
		throw new ApiError(response.status, parsed);
	}

	// 204 No Content
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export const api = {
	get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
	post: <T>(
		path: string,
		body?: JsonBody,
		signal?: AbortSignal,
		headers?: Record<string, string>,
	) => request<T>(path, { method: "POST", body, signal, headers }),
	put: <T>(path: string, body?: JsonBody, signal?: AbortSignal) =>
		request<T>(path, { method: "PUT", body, signal }),
	patch: <T>(path: string, body?: JsonBody, signal?: AbortSignal) =>
		request<T>(path, { method: "PATCH", body, signal }),
	delete: <T>(path: string, signal?: AbortSignal) =>
		request<T>(path, { method: "DELETE", signal }),
	// Multipart upload (plan Phase 1). Do NOT set Content-Type — the browser
	// adds the multipart boundary itself. Keeps the auth cookie via credentials.
	upload: <T>(path: string, formData: FormData, signal?: AbortSignal) =>
		uploadRequest<T>(path, formData, signal),
};

async function uploadRequest<T>(
	path: string,
	formData: FormData,
	signal?: AbortSignal,
): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		method: "POST",
		credentials: "include",
		body: formData,
		signal,
	});

	if (!response.ok) {
		let parsed: unknown = null;
		try {
			parsed = await response.json();
		} catch {
			// body wasn't JSON — keep parsed as null
		}
		throw new ApiError(response.status, parsed);
	}

	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export { API_URL };
