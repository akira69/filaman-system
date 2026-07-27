import { describe, expect, it } from "vitest";

import {
  RepairMappingValidationError,
  buildImportFieldActions,
  buildRepairMappingPayload,
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
