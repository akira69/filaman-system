# Plan: PR B — Allow custom logo upload (override or for missing) alongside FilaManDB logo import

## Goal

Add a focused manufacturer-logo management PR that lets users:
- upload a custom manufacturer logo manually
- import/fill missing logos from FilaManDB
- keep a **manual override path** so user-supplied logos win when desired

This should be a separate PR from the multi-color shading work.

## Important basis note

This PR should be based on the latest upstream branch/release that already contains the new baseline manufacturer logo support.

If the local `main` branch does **not** yet include that upstream logo work, sync `main` first and branch from there before implementing this plan.

## Why this PR is still useful

Even if upstream now supports manufacturer logos generally, there is still value in making the workflow practical for real instances:
- users need a way to **upload or replace** inaccurate logos
- users need a way to **fill missing logos** from FilaManDB in bulk or per manufacturer
- the system needs predictable rules for when imported logos should be skipped vs replaced

## Scope

### Include
- **Manual custom logo upload** for a manufacturer
- **Manual clear/remove logo** action
- **FilaManDB logo import** for:
  - filling missing logos only
  - optionally replacing existing ones when explicitly requested
- **Clear precedence rules** between imported and manually uploaded logos
- **UI messaging** that explains whether a logo came from FilaManDB or from a local override

### Deliberately excluded
- unrelated manufacturer table redesign
- spool/filament multi-color tint work
- broad remote URL-import-from-anywhere flows unless already present upstream and easy to preserve
- major backend asset-storage refactors unrelated to the user-facing workflow

## Recommended behavior model

### Source precedence
1. **Manual uploaded override** (highest priority)
2. **Imported FilaManDB logo**
3. **No logo / fallback text**

### Import modes
- **Import missing only**
  - default safe mode
  - do not touch manufacturers that already have a logo
- **Replace from FilaManDB**
  - explicit action only
  - intended for batch refreshes
- **Upload custom override**
  - marks the logo as locally managed/preferred
  - future "missing only" imports should not overwrite it

## Suggested data model / metadata needs

If upstream already stores logo metadata, extend or reuse that rather than reinventing it.

Useful metadata fields (if not already present):
- `logo_source` = `manual` | `filamandb` | `unknown`
- `logo_updated_at`
- optional `logo_original_url` or provider reference for traceability

If schema changes are too heavy for the first pass, the same behavior can still be approximated with conservative overwrite rules plus UI messaging.

## Candidate files

Backend/API (depends on current upstream implementation):
- manufacturer model/service files
- logo upload/import endpoints
- FilaManDB sync/import service

Frontend:
- manufacturers page/modal
- manufacturer create/edit form
- any existing logo-management helper or preview component

## UX proposal

### In the manufacturer UI
- show current logo preview
- show actions:
  - `Upload custom logo`
  - `Import from FilaManDB`
  - `Clear logo`
- optionally add a small label such as:
  - `Source: Custom override`
  - `Source: FilaManDB`

### For batch import
Add a FilaManDB-assisted action like:
- `Fill missing logos from FilaManDB`
- optional checkbox: `Replace existing imported logos`
- keep manual overrides protected unless explicitly replaced

## Implementation phases

1. **Confirm upstream baseline support**
   - sync latest `main`
   - inspect current logo storage/API/UI behavior
   - identify what already exists vs what still needs to be added

2. **Add/extend backend logo source rules**
   - preserve or add support for local uploads
   - define overwrite logic for FilaManDB imports
   - ensure clear/remove behavior is safe

3. **Add UI controls**
   - upload custom logo
   - import from FilaManDB for missing/selected manufacturers
   - show current source/state clearly

4. **Batch import and safeguards**
   - missing-only default
   - explicit replace option
   - protect manual overrides by default

5. **Validation and polish**
   - verify file type/size validation
   - verify previews and fallback state
   - verify imported logos do not unexpectedly overwrite custom uploads

## Main risks

- accidental overwrite of user-uploaded logos during FilaManDB import
- unclear source-of-truth rules confusing admins
- image validation and storage edge cases
- batch operations being too aggressive by default

## Validation targets

- upload a custom logo for a manufacturer with no existing logo
- replace an existing imported logo with a custom upload
- run `Fill missing logos from FilaManDB` and verify only missing entries are filled
- verify manual overrides are preserved in missing-only mode
- verify explicit replace mode updates only the intended set
- verify clear/remove resets to fallback text correctly
- run backend validation and frontend build after implementation

## Suggested PR title

`feat(manufacturers): allow custom logo override and FilaManDB logo import`

## Suggested PR summary sentence

Add practical manufacturer-logo management on top of the new upstream logo foundation by supporting manual custom overrides, missing-logo import from FilaManDB, and safe overwrite rules.