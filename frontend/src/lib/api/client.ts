import { ApiError } from "#/lib/api/errors";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type JsonBody = Record<string, unknown> | unknown[];

interface RequestOptions {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: JsonBody;
	signal?: AbortSignal;
}

async function request<T>(
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const { method = "GET", body, signal } = options;

	const response = await fetch(`${API_URL}${path}`, {
		method,
		credentials: "include",
		headers: body ? { "Content-Type": "application/json" } : undefined,
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
	post: <T>(path: string, body?: JsonBody, signal?: AbortSignal) =>
		request<T>(path, { method: "POST", body, signal }),
	delete: <T>(path: string, signal?: AbortSignal) =>
		request<T>(path, { method: "DELETE", signal }),
};

export { API_URL };
