import { describe, expect, it } from "vitest";

import {
  RepairMappingValidationError,
  buildImportFieldActions,
  buildRepairMappingPayload,
  convertRepairExampleValue,
  formatRepairExampleValue,
  repairConfidenceTone,
  repairDetailsState,
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
});
