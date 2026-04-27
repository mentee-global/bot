import { Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	SearchableSelect,
	type SelectOption,
} from "#/components/ui/searchable-select";
import {
	getCountryOptions,
	getEducationLevelOptions,
	getGenderOptions,
	getLanguageOptions,
	getRoleOptions,
	getTimezoneOptions,
} from "#/features/admin/data/persona.options";
import type { JsonSchema } from "#/features/admin/data/persona.types";

/**
 * Recursive renderer that turns a JSON Schema field into a controlled input.
 * Coverage tuned to the Pydantic shape of `ChatPersona` + `MenteeProfile`:
 *
 *  - Known fields (timezone, country, language, role…) → searchable select
 *  - string                     → text input
 *  - string + format=date       → date input
 *  - string + format=date-time  → datetime-local input
 *  - string with enum           → select
 *  - long-form string           → textarea
 *  - boolean                    → tri-state select (—/Yes/No)
 *  - integer / number           → number input
 *  - array of strings           → tag list (chip multi-select for languages)
 *  - array of objects           → repeating fieldset with add/remove
 *  - object / $ref              → nested fieldset
 *
 * `$ref`s are resolved *after* unwrapping `anyOf: [T, null]` so optional
 * refs (e.g. `organization: MenteeOrganization | None`) render correctly
 * instead of falling through to a raw fallback.
 */

export interface PersonaFormFieldProps {
	name: string;
	label: string;
	schema: JsonSchema;
	rootSchema: JsonSchema;
	value: unknown;
	onChange: (next: unknown) => void;
	depth?: number;
}

/**
 * Fields hidden from the persona form — they're either too cumbersome to fill
 * by hand for a testing tool (`mentor`: nested record requiring a fake mentor
 * id) or rarely useful for testing (`joined_at`). The model still keeps them
 * so real OAuth data flows through untouched; only the form skips rendering.
 */
const HIDDEN_FIELDS = new Set(["mentor", "joined_at"]);

const SELECT_FIELD_OPTIONS: Record<string, () => SelectOption[]> = {
	timezone: getTimezoneOptions,
	preferred_language: getLanguageOptions,
	country: getCountryOptions,
	role: getRoleOptions,
	gender: getGenderOptions,
	education_level: getEducationLevelOptions,
};

const ARRAY_SELECT_FIELD_OPTIONS: Record<string, () => SelectOption[]> = {
	languages: getLanguageOptions,
};

export function PersonaFormField(props: PersonaFormFieldProps) {
	const { schema, rootSchema, depth = 0 } = props;
	const tail = tailSegment(props.name);

	if (HIDDEN_FIELDS.has(tail)) return null;

	// Two-pass: resolve any top-level $ref, unwrap `anyOf: [T, null]`, then
	// resolve again — `anyOf` may itself contain a $ref (e.g. an optional
	// nested object like `organization: MenteeOrganization | None`).
	const firstPass = resolveSchema(schema, rootSchema);
	const { effective: unwrapped, optional } = unwrapNullable(firstPass);
	const effective = resolveSchema(unwrapped, rootSchema);

	// Hand resolved schema down so child components don't repeat the dance.
	const resolvedProps: PersonaFormFieldProps = { ...props, schema: effective };

	// Special-cased searchable selects. Match by field-name tail so they
	// trigger regardless of nesting (`mentee_profile.country` → countries).
	if (effective.type === "string" && SELECT_FIELD_OPTIONS[tail]) {
		return (
			<SearchableSelectField
				{...resolvedProps}
				options={SELECT_FIELD_OPTIONS[tail]()}
				placeholder={`Select ${humanize(tail).toLowerCase()}…`}
				optional={optional}
			/>
		);
	}

	if (isStringEnum(effective)) {
		const enumOptions = (effective.enum ?? [])
			.filter((v): v is string => typeof v === "string")
			.map((v) => ({ value: v, label: humanize(v) }));
		return (
			<SearchableSelectField
				{...resolvedProps}
				options={enumOptions}
				placeholder="Select…"
				optional={optional}
			/>
		);
	}
	if (isLongFormString(tail, effective)) {
		return <TextareaField {...resolvedProps} />;
	}
	if (effective.type === "string") {
		return <StringField {...resolvedProps} schema={effective} />;
	}
	if (effective.type === "boolean") {
		return <BooleanField {...resolvedProps} optional={optional} />;
	}
	if (effective.type === "integer" || effective.type === "number") {
		return <NumberField {...resolvedProps} schema={effective} />;
	}
	if (effective.type === "array") {
		const itemFirst = resolveSchema(effective.items ?? {}, rootSchema);
		const itemEffective = resolveSchema(
			unwrapNullable(itemFirst).effective,
			rootSchema,
		);
		if (itemEffective.type === "string") {
			if (ARRAY_SELECT_FIELD_OPTIONS[tail]) {
				return (
					<MultiSelectField
						{...resolvedProps}
						options={ARRAY_SELECT_FIELD_OPTIONS[tail]()}
					/>
				);
			}
			return <TagListField {...resolvedProps} />;
		}
		return (
			<ObjectArrayField
				{...resolvedProps}
				schema={effective}
				itemSchema={itemEffective}
				depth={depth}
			/>
		);
	}
	if (effective.type === "object" || effective.properties) {
		return <ObjectField {...resolvedProps} schema={effective} depth={depth} />;
	}

	// Last resort — render as a plain text input rather than a JSON blob so
	// non-technical admins always have a usable widget.
	return <StringField {...resolvedProps} schema={{ type: "string" }} />;
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

function SearchableSelectField({
	label,
	value,
	onChange,
	options,
	placeholder,
	optional,
	schema,
}: PersonaFormFieldProps & {
	options: SelectOption[];
	placeholder: string;
	optional: boolean;
}) {
	const id = useId();
	const stringValue = typeof value === "string" ? value : null;
	return (
		<FieldShell
			id={id}
			label={label}
			optional={optional}
			description={schema.description}
		>
			<SearchableSelect
				id={id}
				value={stringValue}
				onChange={(v) => onChange(v)}
				options={options}
				placeholder={placeholder}
			/>
		</FieldShell>
	);
}

function MultiSelectField({
	label,
	value,
	onChange,
	options,
	schema,
}: PersonaFormFieldProps & { options: SelectOption[] }) {
	const id = useId();
	const list = Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
	const remaining = options.filter((o) => !list.includes(o.value));
	return (
		<FieldShell id={id} label={label} optional description={schema.description}>
			<div className="space-y-2">
				{list.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{list.map((item) => {
							const opt = options.find((o) => o.value === item);
							return (
								<span
									key={item}
									className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
								>
									{opt?.label ?? item}
									<button
										type="button"
										onClick={() => onChange(list.filter((x) => x !== item))}
										aria-label={`Remove ${opt?.label ?? item}`}
										className="rounded-full transition hover:bg-muted/50"
									>
										<X className="size-3" />
									</button>
								</span>
							);
						})}
					</div>
				) : null}
				<SearchableSelect
					id={id}
					value={null}
					onChange={(v) => {
						if (v) onChange([...list, v]);
					}}
					options={remaining}
					placeholder="Add…"
					clearable={false}
				/>
			</div>
		</FieldShell>
	);
}

function StringField({
	label,
	value,
	onChange,
	schema,
}: PersonaFormFieldProps & { schema: JsonSchema }) {
	const id = useId();
	const inputType =
		schema.format === "date"
			? "date"
			: schema.format === "date-time"
				? "datetime-local"
				: schema.format === "email"
					? "email"
					: schema.format === "uri" || schema.format === "url"
						? "url"
						: "text";
	const stringValue = typeof value === "string" ? value : "";
	return (
		<FieldShell id={id} label={label} optional description={schema.description}>
			<Input
				id={id}
				type={inputType}
				value={stringValue}
				onChange={(e) => onChange(e.target.value || null)}
			/>
		</FieldShell>
	);
}

function TextareaField({
	label,
	value,
	onChange,
	schema,
}: PersonaFormFieldProps) {
	const id = useId();
	const stringValue = typeof value === "string" ? value : "";
	return (
		<FieldShell id={id} label={label} optional description={schema.description}>
			<textarea
				id={id}
				value={stringValue}
				onChange={(e) => onChange(e.target.value || null)}
				rows={3}
				className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			/>
		</FieldShell>
	);
}

function NumberField({
	label,
	value,
	onChange,
	schema,
}: PersonaFormFieldProps & { schema: JsonSchema }) {
	const id = useId();
	const stringValue =
		typeof value === "number" || typeof value === "string" ? String(value) : "";
	const isInt = schema.type === "integer";
	return (
		<FieldShell id={id} label={label} optional description={schema.description}>
			<Input
				id={id}
				type="number"
				step={isInt ? 1 : "any"}
				value={stringValue}
				onChange={(e) => {
					const raw = e.target.value;
					if (raw === "") {
						onChange(null);
						return;
					}
					const num = isInt ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
					onChange(Number.isNaN(num) ? null : num);
				}}
			/>
		</FieldShell>
	);
}

function BooleanField({
	label,
	value,
	onChange,
	optional,
	schema,
}: PersonaFormFieldProps & { optional: boolean }) {
	const id = useId();
	const current = value === true ? "true" : value === false ? "false" : "";
	return (
		<FieldShell
			id={id}
			label={label}
			optional={optional}
			description={schema.description}
		>
			<select
				id={id}
				value={current}
				onChange={(e) => {
					const v = e.target.value;
					onChange(v === "true" ? true : v === "false" ? false : null);
				}}
				className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{optional ? <option value="">—</option> : null}
				<option value="true">Yes</option>
				<option value="false">No</option>
			</select>
		</FieldShell>
	);
}

function TagListField({
	label,
	value,
	onChange,
	schema,
}: PersonaFormFieldProps) {
	const id = useId();
	const [pending, setPending] = useState("");
	const list = Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];

	function commit(raw: string): void {
		// Allow pasting "AI, scholarships" — split on commas so paste-from-CSV
		// still works without forcing the user to commit one by one.
		const additions = raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.filter((v) => !list.includes(v));
		if (additions.length === 0) {
			setPending("");
			return;
		}
		onChange([...list, ...additions]);
		setPending("");
	}

	function remove(item: string): void {
		const next = list.filter((x) => x !== item);
		onChange(next.length > 0 ? next : []);
	}

	return (
		<FieldShell
			id={id}
			label={label}
			optional
			description={
				schema.description ?? "Press Enter or comma to add each value."
			}
		>
			<div className="space-y-2">
				{list.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{list.map((item) => (
							<span
								key={item}
								className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
							>
								{item}
								<button
									type="button"
									onClick={() => remove(item)}
									aria-label={`Remove ${item}`}
									className="rounded-full transition hover:bg-muted/50"
								>
									<X className="size-3" />
								</button>
							</span>
						))}
					</div>
				) : null}
				<Input
					id={id}
					type="text"
					value={pending}
					placeholder={
						list.length === 0 ? "Type a value, then Enter…" : "Add another…"
					}
					onChange={(e) => setPending(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === ",") {
							e.preventDefault();
							commit(pending);
						} else if (
							e.key === "Backspace" &&
							pending === "" &&
							list.length > 0
						) {
							e.preventDefault();
							remove(list[list.length - 1]);
						}
					}}
					onBlur={() => {
						if (pending.trim()) commit(pending);
					}}
				/>
			</div>
		</FieldShell>
	);
}

function ObjectField({
	name,
	label,
	schema,
	rootSchema,
	value,
	onChange,
	depth = 0,
}: PersonaFormFieldProps & { schema: JsonSchema }) {
	const properties = schema.properties ?? {};
	const obj = isPlainObject(value) ? value : {};
	const indent = depth > 0;
	return (
		<fieldset
			data-name={name}
			className={
				indent
					? "space-y-3 rounded-md border border-input/60 bg-muted/20 p-3"
					: "space-y-3"
			}
		>
			{indent ? (
				<legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</legend>
			) : null}
			{Object.entries(properties).map(([key, propSchema]) => (
				<PersonaFormField
					key={key}
					name={`${name}.${key}`}
					label={fieldLabel(propSchema, key)}
					schema={propSchema}
					rootSchema={rootSchema}
					value={obj[key]}
					onChange={(next) => {
						const nextObj = { ...obj };
						if (next === null || next === undefined || next === "") {
							delete nextObj[key];
						} else if (Array.isArray(next) && next.length === 0) {
							delete nextObj[key];
						} else {
							nextObj[key] = next;
						}
						onChange(Object.keys(nextObj).length > 0 ? nextObj : null);
					}}
					depth={depth + 1}
				/>
			))}
		</fieldset>
	);
}

function ObjectArrayField({
	name,
	label,
	schema,
	itemSchema,
	rootSchema,
	value,
	onChange,
	depth = 0,
}: PersonaFormFieldProps & { schema: JsonSchema; itemSchema: JsonSchema }) {
	const list = Array.isArray(value) ? value : [];
	const itemLabel =
		itemSchema.title ?? schema.items?.title ?? singularize(label);
	return (
		<fieldset
			data-name={name}
			className="space-y-3 rounded-md border border-input/60 bg-muted/20 p-3"
		>
			<div className="flex items-center justify-between">
				<legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</legend>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 text-xs"
					onClick={() => onChange([...list, blankFor(itemSchema, rootSchema)])}
				>
					+ Add {itemLabel.toLowerCase()}
				</Button>
			</div>
			{list.length === 0 ? (
				<p className="rounded-md border border-dashed border-input/40 bg-background/40 px-3 py-3 text-center text-xs text-muted-foreground">
					No {label.toLowerCase()} added yet.
				</p>
			) : (
				list.map((item, idx) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: list is reordered on remove only
						key={idx}
						className="space-y-3 rounded-md border border-input/40 bg-background/40 p-3"
					>
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-muted-foreground">
								{itemLabel} #{idx + 1}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs"
								onClick={() => {
									const next = list.slice();
									next.splice(idx, 1);
									onChange(next.length > 0 ? next : []);
								}}
							>
								<Trash2 className="mr-1 size-3.5" />
								Remove
							</Button>
						</div>
						<PersonaFormField
							name={`${name}[${idx}]`}
							label={itemLabel}
							schema={itemSchema}
							rootSchema={rootSchema}
							value={item}
							onChange={(next) => {
								const nextList = list.slice();
								nextList[idx] = next;
								onChange(nextList);
							}}
							depth={depth + 1}
						/>
					</div>
				))
			)}
		</fieldset>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldShell({
	id,
	label,
	optional,
	description,
	children,
}: {
	id: string;
	label: string;
	optional?: boolean;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium">
					{label}
				</label>
				{optional ? (
					<span className="text-[11px] uppercase tracking-wide text-muted-foreground">
						Optional
					</span>
				) : null}
			</div>
			{children}
			{description ? (
				<p className="text-xs text-muted-foreground">{description}</p>
			) : null}
		</div>
	);
}

function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
	if (!schema.$ref) return schema;
	const path = schema.$ref.replace(/^#\//, "").split("/");
	let cursor: unknown = root;
	for (const segment of path) {
		if (cursor && typeof cursor === "object" && segment in cursor) {
			cursor = (cursor as Record<string, unknown>)[segment];
		} else {
			return schema;
		}
	}
	return (cursor as JsonSchema) ?? schema;
}

function unwrapNullable(schema: JsonSchema): {
	effective: JsonSchema;
	optional: boolean;
} {
	if (schema.anyOf?.length) {
		const nonNull = schema.anyOf.filter((s) => s.type !== "null");
		const hasNull = nonNull.length !== schema.anyOf.length;
		if (nonNull.length === 1) {
			const merged: JsonSchema = { ...nonNull[0] };
			if (schema.title && !merged.title) merged.title = schema.title;
			if (schema.description && !merged.description)
				merged.description = schema.description;
			return { effective: merged, optional: hasNull };
		}
	}
	return { effective: schema, optional: true };
}

function isStringEnum(schema: JsonSchema): boolean {
	return Boolean(schema.enum && schema.enum.length > 0);
}

const LONG_FORM_FIELDS = new Set([
	"biography",
	"application_notes",
	"description",
	"notes",
	"bio",
]);

function isLongFormString(tail: string, schema: JsonSchema): boolean {
	if (schema.type !== "string") return false;
	return LONG_FORM_FIELDS.has(tail);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fieldLabel(schema: JsonSchema, fallback: string): string {
	if (schema.title) return schema.title;
	return humanize(fallback);
}

function humanize(name: string): string {
	return name
		.split(/[._-]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function tailSegment(name: string): string {
	const segments = name.split(".");
	const last = segments[segments.length - 1];
	// Strip trailing "[idx]" from array entries so language[0] still matches "language".
	return last.replace(/\[\d+\]$/, "");
}

function blankFor(schema: JsonSchema, root: JsonSchema): unknown {
	const resolved = resolveSchema(schema, root);
	const { effective } = unwrapNullable(resolved);
	const finalSchema = resolveSchema(effective, root);
	if (finalSchema.type === "object" || finalSchema.properties) {
		const out: Record<string, unknown> = {};
		const required = finalSchema.required ?? [];
		for (const key of required) {
			const child = finalSchema.properties?.[key];
			if (!child) continue;
			out[key] = blankFor(child, root);
		}
		return out;
	}
	if (finalSchema.type === "array") return [];
	if (finalSchema.type === "boolean") return null;
	if (finalSchema.type === "integer" || finalSchema.type === "number")
		return null;
	return "";
}

function singularize(label: string): string {
	if (label.endsWith("ies")) return `${label.slice(0, -3)}y`;
	if (label.endsWith("s") && !label.endsWith("ss")) return label.slice(0, -1);
	return label;
}
