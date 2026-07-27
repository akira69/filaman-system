import { describe, expect, it } from "vitest";

import {
  RepairMappingValidationError,
  buildImportExtraFieldResultSummary,
  buildImportFieldActions,
  buildRepairMappingPayload,
  convertRepairExampleValue,
  formatRepairExampleValue,
  importStorageActionTranslationKey,
  repairConfidenceReason,
  repairConfidenceTone,
  repairDetailsState,
  resolveImportDefinitionAvailability,
  resolveImportModeAvailability,
  type RepairMapping,
} from "./spoolman-extra-field-ui";

const source: RepairMapping = {
  target_type: "filament",
  key: "drying_temperature",
  label: "Drying temperature",
  field_type: "number",
  source_field_type: "integer",
  config: { decimal_places: 0, unit: "°C" },
  options: null,
  default_value: "55",
};

describe("Spoolman repair field controls", () => {
  it("shows units only for number and range fields", () => {
    expect(repairDetailsState(source, "number")).toEqual({
      kind: "unit",
      value: "°C",
      disabled: false,
      required: false,
    });
    expect(repairDetailsState(source, "date")).toEqual({
      kind: "none",
      value: "",
      disabled: true,
      required: false,
    });
  });

  it("does not carry a numeric unit into dropdown choices", () => {
    expect(repairDetailsState(source, "dropdown", "number", "°C")).toEqual({
      kind: "choices",
      value: "",
      disabled: false,
      required: true,
    });
  });

  it("keeps edited details when switching within the same type family", () => {
    expect(
      repairDetailsState(source, "range", "number", "degrees"),
    ).toMatchObject({ kind: "unit", value: "degrees" });
  });
});

describe("Spoolman repair preview evidence", () => {
  it.each([
    ["authoritative", "info"],
    ["high", "success"],
    ["medium", "warning"],
    ["low", "error"],
    ["unresolved", "neutral"],
  ] as const)("maps %s confidence to the %s tone", (confidence, tone) => {
    expect(repairConfidenceTone(confidence)).toBe(tone);
  });

  it("uses the audited reason and replaces it after a manual type change", () => {
    const legacyText: RepairMapping = {
      ...source,
      field_type: "text",
      source_field_type: "text",
      confidence: "low",
      confidence_reason: "legacy_scalar",
    };

    expect(repairConfidenceReason(legacyText)).toBe("legacy_text");
    expect(repairConfidenceReason(legacyText, "datetime")).toBe("manual");
  });

  it.each([
    ["text", "legacy_text"],
    ["number", "legacy_number"],
    ["checkbox", "legacy_checkbox"],
  ] as const)(
    "explains which source types a legacy %s value could represent",
    (fieldType, reason) => {
      expect(
        repairConfidenceReason({
          ...source,
          field_type: fieldType,
          confidence: "low",
          confidence_reason: "legacy_scalar",
        }),
      ).toBe(reason);
    },
  );

  it("falls back to a confidence-specific reason for older previews", () => {
    expect(
      repairConfidenceReason({
        ...source,
        confidence: "high",
        confidence_reason: undefined,
      }),
    ).toBe("generic_high");
  });

  it("formats actual converted values for compact before/after examples", () => {
    expect(
      formatRepairExampleValue(
        "true",
        "checkbox",
        false,
        "Checked",
        "Unchecked",
      ),
    ).toBe("true");
    expect(
      formatRepairExampleValue(true, "checkbox", true, "Checked", "Unchecked"),
    ).toBe("Checked");
    expect(
      formatRepairExampleValue(
        { min: 190, max: 230 },
        "range",
        true,
        "Checked",
        "Unchecked",
      ),
    ).toBe("190 – 230");
    expect(
      formatRepairExampleValue(
        '"2026-07-27T15:45:30Z"',
        "date",
        false,
        "Checked",
        "Unchecked",
      ),
    ).toBe("2026-07-27T15:45:30Z");
  });

  it("recalculates examples when the user changes the suggested type", () => {
    const datetimeSource: RepairMapping = {
      ...source,
      field_type: "datetime",
      source_field_type: "datetime",
      config: null,
    };

    expect(
      convertRepairExampleValue(
        '"2026-07-27T15:45:30Z"',
        datetimeSource,
        "date",
      ),
    ).toEqual({ ok: true, value: "2026-07-27" });
    expect(
      convertRepairExampleValue('"not a date"', datetimeSource, "date"),
    ).toEqual({ ok: false });
    expect(convertRepairExampleValue("[190,230]", source, "range")).toEqual({
      ok: true,
      value: { min: 190, max: 230 },
    });
  });

  it("uses edited choices when previewing dropdown conversions", () => {
    const choiceSource: RepairMapping = {
      ...source,
      field_type: "text",
      source_field_type: "text",
      config: null,
    };

    expect(
      convertRepairExampleValue("PLA", choiceSource, "dropdown", [
        "PLA",
        "PETG",
      ]),
    ).toEqual({ ok: true, value: "PLA" });
    expect(
      convertRepairExampleValue("TPU", choiceSource, "dropdown", [
        "PLA",
        "PETG",
      ]),
    ).toEqual({ ok: false });
  });
});

describe("Spoolman repair payloads", () => {
  it("serializes and deduplicates dropdown choices", () => {
    const payload = buildRepairMappingPayload(source, {
      label: "Drying profile",
      fieldType: "dropdown",
      details: "PLA, PETG, PLA",
      action: "local",
    });

    expect(payload).toMatchObject({
      label: "Drying profile",
      field_type: "dropdown",
      options: ["PLA", "PETG"],
      config: null,
      default_value: null,
      action: "local",
    });
  });

  it("rejects dropdown and multi-select mappings without choices", () => {
    expect(() =>
      buildRepairMappingPayload(source, {
        label: source.label,
        fieldType: "multiselect",
        details: " , ",
        action: "system",
      }),
    ).toThrow(RepairMappingValidationError);
  });

  it("preserves numeric configuration without leaking it to other types", () => {
    expect(
      buildRepairMappingPayload(source, {
        label: source.label,
        fieldType: "range",
        details: "K",
        action: "system",
      }).config,
    ).toEqual({ decimal_places: 0, unit: "K" });

    expect(
      buildRepairMappingPayload(source, {
        label: source.label,
        fieldType: "text",
        details: "",
        action: "system",
      }).config,
    ).toBeNull();
  });
});

describe("Spoolman import overrides", () => {
  it("maps each global storage mode to its resolved per-field label", () => {
    expect(importStorageActionTranslationKey("system")).toBe(
      "extraFieldActionSystem",
    );
    expect(importStorageActionTranslationKey("local")).toBe(
      "extraFieldActionLocal",
    );
    expect(importStorageActionTranslationKey("preserve")).toBe(
      "extraFieldActionPreserve",
    );
    expect(importStorageActionTranslationKey("legacy")).toBe(
      "extraFieldActionLegacy",
    );
  });

  it("summarizes created, reused, local, converted, and preserved fields", () => {
    expect(
      buildImportExtraFieldResultSummary({
        extra_fields_created: 6,
        extra_fields_reused: 2,
        extra_local_definitions: 1,
        extra_values_promoted: 29,
        extra_values_preserved: 3,
        extra_fields_conflicted: 1,
      }),
    ).toEqual({
      systemCreated: 6,
      systemReused: 2,
      localCreated: 1,
      valuesConverted: 29,
      valuesPreserved: 3,
      conflicts: 1,
      hasActivity: true,
    });
  });

  it("hides the extra-field result section when every counter is absent", () => {
    expect(buildImportExtraFieldResultSummary({})).toEqual({
      systemCreated: 0,
      systemReused: 0,
      localCreated: 0,
      valuesConverted: 0,
      valuesPreserved: 0,
      conflicts: 0,
      hasActivity: false,
    });
  });

  it("omits inherited and incomplete selections", () => {
    expect(
      buildImportFieldActions([
        {
          targetType: "filament",
          key: "drying_temperature",
          action: "inherit",
        },
        { targetType: "spool", key: "inspection", action: "local" },
        { targetType: undefined, key: "ignored", action: "system" },
      ]),
    ).toEqual([
      {
        target_type: "spool",
        key: "inspection",
        action: "local",
      },
    ]);
  });

  it("falls back explicitly when typed definitions are unavailable", () => {
    expect(resolveImportModeAvailability("system", false)).toEqual({
      mode: "legacy",
      typedModesDisabled: true,
    });
    expect(resolveImportModeAvailability("local", false)).toEqual({
      mode: "legacy",
      typedModesDisabled: true,
    });
    expect(resolveImportModeAvailability("preserve", false)).toEqual({
      mode: "preserve",
      typedModesDisabled: true,
    });
    expect(resolveImportModeAvailability("system", true)).toEqual({
      mode: "system",
      typedModesDisabled: false,
    });
  });

  it("detects complete, partial, and unavailable typed field targets", () => {
    expect(
      resolveImportDefinitionAvailability(["vendor", "filament", "spool"]),
    ).toEqual({
      typedDefinitionsAvailable: true,
      missingTargets: [],
    });
    expect(resolveImportDefinitionAvailability(["filament"])).toEqual({
      typedDefinitionsAvailable: true,
      missingTargets: ["spool"],
    });
    expect(resolveImportDefinitionAvailability(["vendor"])).toEqual({
      typedDefinitionsAvailable: false,
      missingTargets: ["filament", "spool"],
    });
    expect(resolveImportDefinitionAvailability(undefined)).toEqual({
      typedDefinitionsAvailable: false,
      missingTargets: ["filament", "spool"],
    });
  });
});
