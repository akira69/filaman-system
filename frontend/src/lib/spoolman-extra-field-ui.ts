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
