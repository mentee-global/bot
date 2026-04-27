import { queryOptions } from "@tanstack/react-query";
import type { JsonSchema } from "#/features/admin/data/persona.types";
import { api } from "#/lib/api/client";

export const personaService = {
	getSchema: (signal?: AbortSignal) =>
		api.get<JsonSchema>("/api/admin/persona/schema", signal),
};

export const personaKeys = {
	root: ["admin", "persona"] as const,
	schema: () => [...personaKeys.root, "schema"] as const,
};

export function personaSchemaQueryOptions(enabled: boolean) {
	return queryOptions({
		queryKey: personaKeys.schema(),
		queryFn: ({ signal }) => personaService.getSchema(signal),
		enabled,
		// Schema is generated from a Pydantic model that only changes on deploy.
		staleTime: Infinity,
	});
}
