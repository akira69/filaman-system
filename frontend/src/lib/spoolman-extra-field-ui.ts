export const repairFieldTypes = [
  "text",
  "number",
  "range",
  "dropdown",
  "multiselect",
  "checkbox",
  "date",
  "datetime",
  "url",
  "textarea",
] as const;

export type RepairFieldType = (typeof repairFieldTypes)[number];
export type RepairStorageAction = "system" | "local" | "preserve";
export type RepairConfidence =
  | "authoritative"
  | "high"
  | "medium"
  | "low"
  | "unresolved";
export type RepairConfidenceTone =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "neutral";
export interface RepairExampleConversion {
  ok: boolean;
  value?: unknown;
}
export type ImportStorageAction =
  | "inherit"
  | "system"
  | "local"
  | "preserve"
  | "legacy";

export interface RepairMapping {
  target_type: "filament" | "spool";
  key: string;
  label: string;
  field_type: RepairFieldType;
  confidence?: RepairConfidence;
  confidence_reason?: string;
  occurrences?: number;
  promotable_occurrences?: number;
  preserved_occurrences?: number;
  conversion_examples?: Array<{
    source: unknown;
    converted: unknown;
  }>;
  source_field_type?: string | null;
  options?: string[] | null;
  config?: Record<string, unknown> | null;
  default_value?: string | null;
  [key: string]: unknown;
}

export interface RepairMappingEdits {
  label: string;
  fieldType: RepairFieldType;
  details: string;
  action: RepairStorageAction;
}

export interface ImportFieldSelection {
  targetType?: string;
  key?: string;
  action: ImportStorageAction;
}

export class RepairMappingValidationError extends Error {
  constructor(public readonly code: "choices_required") {
    super(code);
  }
}

export function repairConfidenceTone(
  confidence?: string,
): RepairConfidenceTone {
  if (confidence === "authoritative") return "info";
  if (confidence === "high") return "success";
  if (confidence === "medium") return "warning";
  if (confidence === "low") return "error";
  return "neutral";
}

export function formatRepairExampleValue(
  value: unknown,
  fieldType: RepairFieldType,
  converted: boolean,
  checkedLabel: string,
  uncheckedLabel: string,
): string {
  let displayValue = value;
  if (!converted && typeof displayValue === "string") {
    try {
      displayValue = JSON.parse(displayValue);
    } catch {
      // Legacy cleaned strings are already display-ready.
    }
  }
  if (
    converted &&
    fieldType === "checkbox" &&
    typeof displayValue === "boolean"
  ) {
    return displayValue ? checkedLabel : uncheckedLabel;
  }
  if (
    converted &&
    fieldType === "range" &&
    displayValue &&
    typeof displayValue === "object" &&
    !Array.isArray(displayValue) &&
    ("min" in displayValue || "max" in displayValue)
  ) {
    const range = displayValue as { min?: unknown; max?: unknown };
    return `${range.min ?? "—"} – ${range.max ?? "—"}`;
  }
  if (displayValue === null) return "null";
  if (typeof displayValue === "string") return displayValue;
  if (typeof displayValue === "number" || typeof displayValue === "boolean") {
    return String(displayValue);
  }
  return JSON.stringify(displayValue);
}

export function convertRepairExampleValue(
  storedValue: unknown,
  source: RepairMapping,
  fieldType: RepairFieldType,
  options: string[] = [],
): RepairExampleConversion {
  const parsed = parseStoredExample(storedValue);
  const text = decodeTextExample(storedValue);

  if (fieldType === "text" || fieldType === "textarea" || fieldType === "url") {
    return text === null ? { ok: false } : { ok: true, value: text };
  }
  if (fieldType === "date") {
    if (text === null || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(text)) {
      return { ok: false };
    }
    const date = text.slice(0, 10);
    return Number.isNaN(Date.parse(`${date}T00:00:00Z`))
      ? { ok: false }
      : { ok: true, value: date };
  }
  if (fieldType === "datetime") {
    return text !== null && !Number.isNaN(Date.parse(text))
      ? { ok: true, value: text }
      : { ok: false };
  }
  if (fieldType === "number") {
    const integerOnly =
      source.source_field_type === "integer" ||
      source.config?.decimal_places === 0;
    return typeof parsed === "number" &&
      Number.isFinite(parsed) &&
      (!integerOnly || Number.isInteger(parsed))
      ? { ok: true, value: parsed }
      : { ok: false };
  }
  if (fieldType === "range") {
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !parsed.every(
        (value) =>
          value === null ||
          (typeof value === "number" && Number.isFinite(value)),
      )
    ) {
      return { ok: false };
    }
    const integerOnly =
      source.source_field_type === "integer_range" ||
      source.config?.decimal_places === 0;
    if (
      integerOnly &&
      parsed.some((value) => value !== null && !Number.isInteger(value))
    ) {
      return { ok: false };
    }
    return { ok: true, value: { min: parsed[0], max: parsed[1] } };
  }
  if (fieldType === "checkbox") {
    return typeof parsed === "boolean"
      ? { ok: true, value: parsed }
      : { ok: false };
  }
  if (fieldType === "dropdown") {
    if (typeof parsed !== "string") return { ok: false };
    return options.length && !options.includes(parsed)
      ? { ok: false }
      : { ok: true, value: parsed };
  }
  if (fieldType === "multiselect") {
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value) => typeof value === "string")
    ) {
      return { ok: false };
    }
    return options.length &&
      parsed.some((value) => !options.includes(value as string))
      ? { ok: false }
      : { ok: true, value: parsed };
  }
  return { ok: false };
}

function parseStoredExample(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function decodeTextExample(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseStoredExample(value);
  return typeof parsed === "string" ? parsed : value;
}

type DetailsKind = "unit" | "choices" | "none";

function detailsKind(fieldType: RepairFieldType): DetailsKind {
  if (fieldType === "number" || fieldType === "range") return "unit";
  if (fieldType === "dropdown" || fieldType === "multiselect") return "choices";
  return "none";
}

export function repairDetailsState(
  source: RepairMapping,
  fieldType: RepairFieldType,
  previousFieldType?: RepairFieldType,
  currentValue = "",
): {
  kind: DetailsKind;
  value: string;
  disabled: boolean;
  required: boolean;
} {
  const kind = detailsKind(fieldType);
  if (kind === "none") {
    return { kind, value: "", disabled: true, required: false };
  }

  if (
    previousFieldType &&
    detailsKind(previousFieldType) === kind &&
    currentValue
  ) {
    return {
      kind,
      value: currentValue,
      disabled: false,
      required: kind === "choices",
    };
  }

  const value =
    kind === "unit"
      ? String(source.config?.unit || "")
      : (source.options || []).join(", ");
  return {
    kind,
    value,
    disabled: false,
    required: kind === "choices",
  };
}

export function buildRepairMappingPayload(
  source: RepairMapping,
  edits: RepairMappingEdits,
): RepairMapping & {
  action: RepairStorageAction;
  options: string[] | null;
  config: Record<string, unknown> | null;
} {
  const isNumeric = edits.fieldType === "number" || edits.fieldType === "range";
  const isChoice =
    edits.fieldType === "dropdown" || edits.fieldType === "multiselect";
  const options = isChoice
    ? Array.from(
        new Set(
          edits.details
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      )
    : null;
  if (isChoice && !options?.length) {
    throw new RepairMappingValidationError("choices_required");
  }

  const sourceConfig =
    source.field_type === "number" || source.field_type === "range"
      ? source.config || {}
      : {};
  const config = isNumeric
    ? {
        ...sourceConfig,
        unit: edits.details.trim() || undefined,
      }
    : null;

  return {
    ...source,
    label: edits.label.trim() || source.key,
    field_type: edits.fieldType,
    options,
    config,
    default_value:
      edits.fieldType === source.field_type ? source.default_value : null,
    action: edits.action,
  };
}

export function buildImportFieldActions(
  selections: ImportFieldSelection[],
): Array<{ target_type: string; key: string; action: string }> {
  return selections.flatMap((selection) => {
    if (
      selection.action === "inherit" ||
      !selection.targetType ||
      !selection.key
    ) {
      return [];
    }
    return [
      {
        target_type: selection.targetType,
        key: selection.key,
        action: selection.action,
      },
    ];
  });
}
