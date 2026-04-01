# Export Implementation Map: FilaMan

## Files To Change

### frontend/package.json
- Add the DOM-to-image dependency used for PNG capture from the live label preview.

### frontend/src/utils/labelExport.ts
- New shared helper module.
- Build planned filenames from resolved label fields.
- Sanitize filenames for downloads.
- Convert rendered label DOM to PNG.
- Inject PNG DPI metadata.
- Build AML XML around the PNG payload.
- Trigger file downloads.

### frontend/src/pages/filaments/[id]/print.astro
- Add the collapsible `Export` section above the action buttons.
- Compute a shared display-state model for preview and export.
- Show planned file name text based on enabled display fields.
- Export the rendered label as PNG or AML.
- Store export settings in the existing filament label local storage entry.

### frontend/src/pages/spools/[id]/print.astro
- Mirror the export section and button behavior from the filament page.
- Reuse existing spool-specific preview data, including extra fields.
- Store export settings in the spool label local storage entry.

### frontend/src/i18n/en.json
- Add export strings for print pages.

### frontend/src/i18n/de.json
- Add German export strings matching the English additions.

## Shared Data Model

Each print page should expose a small resolved model used by both preview and export:

- `widthMm`
- `heightMm`
- `qrSizeMm`
- `fontScale`
- `showQR`
- `showId`
- `showManufacturer`
- `showMaterial`
- `showColor`
- `resolvedTitle`
- `resolvedSubtitle`
- `resolvedColor`
- `filenameParts`

## Filename Rules

- Start from the same fields the user currently chose to display.
- Keep a stable field order.
- Omit unchecked or empty fields.
- Fallback to entity type plus ID if all optional parts are empty.
- Append the final extension only at download time.

### Proposed Order

- Filament: manufacturer, material, designation, color, id
- Spool: manufacturer, material, designation, color, spool id

## Export Flow

1. Read selected format and current preview settings.
2. Build the planned base filename.
3. Capture the current preview node to PNG.
4. If PNG:
   - apply selected DPI metadata
   - download `.png`
5. If AML:
   - render the embedded PNG at the selected export DPI
   - wrap that image in AML XML
   - download `.aml`

## Implementation Notes

- Keep the export section collapsed by default.
- Keep the DPI slider visible for both export formats because both outputs are raster-backed.
- For AML, reuse the same captured PNG payload rather than building a second visual renderer.
- Re-render QR content at export scale before capture so embedded AML images stay sharp in label editors.
- Preserve current print behavior and reset behavior.
- Avoid mutating existing saved settings structures in-place when updating export values.

## Expected Verification

- `npm install` updates lockfile cleanly.
- Frontend build succeeds.
- Both print pages render with the new export section.
- Downloads use the previewed filename and chosen extension.