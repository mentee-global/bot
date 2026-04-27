import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import {
	fieldLabel,
	PersonaFormField,
} from "#/features/admin/components/PersonaFormField";
import { personaSchemaQueryOptions } from "#/features/admin/data/persona.service";
import type {
	JsonSchema,
	PersonaPayload,
} from "#/features/admin/data/persona.types";
import {
	personaStore,
	usePersonaState,
} from "#/features/admin/hooks/usePersonaStore";

interface PersonaSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * Slide-over editor for the admin "Test persona" payload.
 *
 * The form is rendered from the JSON Schema at `GET /api/admin/persona/schema`,
 * so changes to the backend's `ChatPersona` / `MenteeProfile` Pydantic models
 * surface here automatically. Local draft state lives in this component;
 * "Save & activate" promotes the draft to the global persona store.
 */
export function PersonaSheet({ open, onOpenChange }: PersonaSheetProps) {
	const schemaQuery = useQuery(personaSchemaQueryOptions(open));
	const { data: persisted } = usePersonaState();
	const [draft, setDraft] = useState<PersonaPayload>({});

	// Re-seed the draft whenever the sheet opens so admins always start from
	// the currently-persisted persona, not stale local state.
	useEffect(() => {
		if (open) setDraft(persisted ?? {});
	}, [open, persisted]);

	const schema = schemaQuery.data;
	const sections = useMemo(() => buildSections(schema), [schema]);

	function update(name: string, next: unknown): void {
		setDraft((prev) => {
			const out: PersonaPayload = { ...prev };
			if (next === null || next === undefined || next === "") {
				delete out[name];
			} else if (Array.isArray(next) && next.length === 0) {
				delete out[name];
			} else {
				out[name] = next;
			}
			return out;
		});
	}

	function handleSave(): void {
		personaStore.saveAndActivate(draft);
		onOpenChange(false);
	}

	function handleDisable(): void {
		personaStore.setActive(false);
		onOpenChange(false);
	}

	function handleClear(): void {
		setDraft({});
		personaStore.clear();
	}

	const draftIsEmpty = Object.keys(draft).length === 0;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full overflow-hidden sm:max-w-xl">
				<SheetHeader className="space-y-1 border-b px-5 py-4">
					<SheetTitle className="text-base">Test persona</SheetTitle>
					<SheetDescription className="text-sm">
						Pretend to be a different mentee for this conversation. The agent
						will respond as if you had this profile — useful for testing without
						logging in as another user. Your account is still what gets billed.
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{schemaQuery.isPending ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Loading…
						</div>
					) : schemaQuery.isError || !schema ? (
						<p className="text-sm text-destructive">
							Couldn't load the persona form. Try reopening the panel.
						</p>
					) : (
						<div className="space-y-8">
							{sections.map((section) => (
								<section key={section.key} className="space-y-4">
									<header className="space-y-1">
										<h3 className="text-sm font-semibold">{section.label}</h3>
										{section.description ? (
											<p className="text-xs text-muted-foreground">
												{section.description}
											</p>
										) : null}
									</header>
									<div className="space-y-4">
										{section.fields.map(({ name, propSchema }) => (
											<PersonaFormField
												key={name}
												name={name}
												label={fieldLabel(propSchema, name)}
												schema={propSchema}
												rootSchema={schema}
												value={draft[name]}
												onChange={(next) => update(name, next)}
											/>
										))}
									</div>
								</section>
							))}
						</div>
					)}
				</div>

				<div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
					<Button
						variant="ghost"
						size="sm"
						onClick={handleClear}
						disabled={
							draftIsEmpty &&
							(!persisted || Object.keys(persisted).length === 0)
						}
					>
						Reset
					</Button>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleDisable}
							disabled={!persisted || Object.keys(persisted).length === 0}
						>
							Disable
						</Button>
						<Button size="sm" onClick={handleSave} disabled={draftIsEmpty}>
							Save &amp; activate
						</Button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

interface Section {
	key: string;
	label: string;
	description?: string;
	fields: { name: string; propSchema: JsonSchema }[];
}

/**
 * Group top-level ChatPersona fields into two visual sections: identity
 * (scalar fields) and the nested mentee_profile object. Profile sub-fields
 * are flattened into the same section so the form reads like one form, not
 * two.
 */
function buildSections(schema: JsonSchema | undefined): Section[] {
	if (!schema?.properties) return [];
	const identityFields: Section["fields"] = [];
	const profileFields: Section["fields"] = [];
	for (const [key, propSchema] of Object.entries(schema.properties)) {
		if (key === "mentee_profile") {
			profileFields.push({ name: key, propSchema });
		} else {
			identityFields.push({ name: key, propSchema });
		}
	}
	const sections: Section[] = [];
	if (identityFields.length > 0) {
		sections.push({
			key: "identity",
			label: "Basics",
			description: "How the agent will address them and which language to use.",
			fields: identityFields,
		});
	}
	if (profileFields.length > 0) {
		sections.push({
			key: "profile",
			label: "Mentee profile",
			description:
				"Background details we'd normally pull from the Mentee app — leave any blank.",
			fields: profileFields,
		});
	}
	return sections;
}
