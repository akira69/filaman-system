# Export Plan: Spoolman PR 860 into FilaMan

## Goal

Add an `Export` section to FilaMan print pages so users can export the current label as either `PNG` or `AML` without leaving the page.

## Scope

- Add a collapsible `Export` section above the existing `Print` and `Defaults` buttons.
- Support `PNG` and `AML` export on both filament and spool print pages.
- Show a DPI control for raster export quality, defaulting to `300`, and apply it to both `PNG` and `AML` because AML wraps an embedded PNG payload.
- Show a small planned filename preview derived from the currently enabled `Display` checkboxes.
- Label the action button dynamically as `Export PNG` or `Export AML`.
- Keep export single-label only for this phase.

## Deliberately Excluded

- Separate export routes or selection dialogs.
- ZIP packaging.
- Preset management.
- Filename templates.
- Multi-label export batches.

## Design Decisions

- Keep export inside the existing print page because FilaMan already uses dedicated single-item print pages.
- Use the rendered preview as the export source of truth so preview and downloaded output stay aligned.
- Port the reliable PNG DPI metadata writing and AML XML generation concepts from Spoolman PR 860, but keep the FilaMan implementation narrower.
- Persist export UI state alongside each page's existing saved print settings.

## Execution Phases

1. Add shared export helpers.
   - Filename sanitization.
   - Planned filename generation from currently visible fields.
   - PNG export with explicit DPI metadata.
   - AML XML generation from exported PNG data.

2. Extend filament print page.
   - Add collapsible export UI.
   - Wire PNG and AML downloads.
   - Persist export format and DPI settings.

3. Extend spool print page.
   - Reuse the same export helpers and UI pattern.
   - Keep spool-specific field naming and local storage behavior intact.

4. Add translations and validation.
   - English and German labels.
   - Frontend dependency install and build check.

## Main Risks

- Exported PNGs may appear as 72 DPI unless pHYs metadata is written explicitly.
- AML sharpness depends on the actual pixel dimensions of the embedded PNG, not just PNG metadata, so the label preview must render raster assets at export resolution.
- AML compatibility depends on preserving the XML shape expected by Labelife-compatible tools.
- Filename generation must stay coupled to displayed fields so the preview text and actual file name do not diverge.

## Validation Targets

- Export filament label as PNG at default DPI.
- Export filament label as PNG at custom DPI and verify dimensions change.
- Export filament label as AML and verify file downloads successfully.
- Export spool label as PNG and AML.
- Toggle display checkboxes and confirm the planned filename updates accordingly.
- Reload the page and confirm export format and DPI are restored.
- Verify AML exports stay sharp in Labelife by comparing 300 DPI and higher DPI outputs.