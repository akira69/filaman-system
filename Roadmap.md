# Roadmap

_Last updated 2026-09-15: smart table/color filtering ([PR #168](https://github.com/Fire-Devils/filaman-system/pull/168)), selectable manufacturer-logo columns ([PR #165](https://github.com/Fire-Devils/filaman-system/pull/165)), device administration hardening ([PR #162](https://github.com/Fire-Devils/filaman-system/pull/162)), and the redesigned AMS View ([PR #160](https://github.com/Fire-Devils/filaman-system/pull/160), [#161](https://github.com/Fire-Devils/filaman-system/pull/161)) are upstream and released through v1.3.6._

## ✅ Done — upstream (Fire-Devils/filaman-system)

Features live in upstream, either merged from this fork or independently implemented there.

- **Speed up screen refresh** — async dashboard and list load improvements *(upstream independently implemented)*
  - Dashboard async session concurrency fix — [PR #2](https://github.com/akira69/filaman-system/pull/2) *(upstream independently fixed in `d41ae3c`)*
  - FilamentDB sync UI performance — [PR #12](https://github.com/akira69/filaman-system/pull/12) *(upstream independently fixed in `8b35ce9`)*
  - FilamentDB stale color position collision fix — [PR #11](https://github.com/akira69/filaman-system/pull/11) *(upstream independently fixed in `babba6b`)*

- **Manufacturer logo support** *(Spoolman basis PR #857)* — upstream v1.2.1; [fork PR #4](https://github.com/akira69/filaman-system/pull/4) closed

- **Material filter deduplication** — [fork PR #5](https://github.com/akira69/filaman-system/pull/5) accepted upstream as [PR #29](https://github.com/Fire-Devils/filaman-system/pull/29) ✓

- **Server-side spool count sort** — [fork PR #13](https://github.com/akira69/filaman-system/pull/13) accepted upstream as [PR #53](https://github.com/Fire-Devils/filaman-system/pull/53) ✓

- **Initial filament label printing baseline** *(Spoolman basis PR #846)* — [fork PR #1](https://github.com/akira69/filaman-system/pull/1) → merged upstream as [PR #26](https://github.com/Fire-Devils/filaman-system/pull/26); label print page subsequently overhauled upstream in [PR #55](https://github.com/Fire-Devils/filaman-system/pull/55) and superseded by the newer shared filament/spool print work in PRs #91/#95 ✓

- **Initial label export workflow** — PNG/AML *(Spoolman basis PR #860)* — [fork PR #3](https://github.com/akira69/filaman-system/pull/3) → merged upstream as [PR #27](https://github.com/Fire-Devils/filaman-system/pull/27), then reverted ([PR #30](https://github.com/Fire-Devils/filaman-system/pull/30)) and replaced by print page overhaul [PR #55](https://github.com/Fire-Devils/filaman-system/pull/55); newer export behavior is tracked under PRs #90/#93/#95 ✓

- **Advanced label designer** — rich per-field template placement on print page — [fork PR #14](https://github.com/akira69/filaman-system/pull/14) → merged upstream as [PR #80](https://github.com/Fire-Devils/filaman-system/pull/80) ✓

- **Advanced label designer modifier chips** — `**bold**`, `*italic*`, `__underline__`, `==inverse==`, `@@filament inverse@@`, `^^caps^^` quick-insert tokens; supersedes caps-only PR #30 — [fork PR #32](https://github.com/akira69/filaman-system/pull/32) → merged upstream as [PR #84](https://github.com/Fire-Devils/filaman-system/pull/84) ✓

- **FilaManDB filament search fuzzy matching** — lookup fallback for punctuated/catalog variants (`Matte Marine Blue` → `Matte - Marine Blue 11600`); backend `resolve-from-tag` endpoint — [fork PR #31](https://github.com/akira69/filaman-system/pull/31) → merged upstream as [PR #85](https://github.com/Fire-Devils/filaman-system/pull/85) ✓

- **Label print/export hardening**
  - Hide preview zoom bar from print output and set explicit label-printer page orientation — merged upstream as [PR #88](https://github.com/Fire-Devils/filaman-system/pull/88) ✓
  - Unify spool label designer and restore PNG/PDF exports — [fork PR #34](https://github.com/akira69/filaman-system/pull/34) → merged upstream as [PR #90](https://github.com/Fire-Devils/filaman-system/pull/90) ✓
  - Fix label export with blob-backed manufacturer logos — merged upstream as [PR #93](https://github.com/Fire-Devils/filaman-system/pull/93) ✓
  - Fix browser print sizing for spool labels — merged upstream as [PR #94](https://github.com/Fire-Devils/filaman-system/pull/94) ✓

- **Filament label printing and label-paper sheet printing**
  - Filament print pages, shared spool/filament label code, shared presets, field grouping, and multi-color swatch rendering — merged upstream as [PR #91](https://github.com/Fire-Devils/filaman-system/pull/91) ✓
  - Label-paper sheet printing for batches and single-label pages, including sheet layout presets and print/export controls — merged upstream as [PR #95](https://github.com/Fire-Devils/filaman-system/pull/95) ✓

- **Reliable selectable label printing and shared output pipeline** — [fork PR #46](https://github.com/akira69/filaman-system/pull/46) → merged upstream as [PR #141](https://github.com/Fire-Devils/filaman-system/pull/141) and released in [v1.2.48](https://github.com/Fire-Devils/filaman-system/releases/tag/v1.2.48) ✓
  - Keeps normal browser printing as the default and adds a persisted, opt-in exact-size temporary-PDF route with inline preview and open/download fallbacks.
  - Adds flattened Labelife AML export and centralizes PNG, AML, PDF, and Print handling across single/batch filament/spool labels in Standard and Advanced Designer modes.
  - Stabilizes off-screen capture and multi-page exports, improves printer guidance and narrow-screen UI behavior, and clarifies built-in, System Extra Field, and per-record Custom Field token catalogs.
  - Completes the planned shared print-page runtime refactor: the four route adapters are 771 net lines smaller than `devel`, with output coordination, rendering, data adapters, preview lifecycle, and cleanup moved into reusable modules and components.

- **Printer/spool workflow upgrades** *(upstream independently merged)*
  - Bambu cloud slicer-profile picker, AMS fixes, and spool core/adapter weight tracking — [upstream PR #96](https://github.com/Fire-Devils/filaman-system/pull/96) ✓
  - Per-model slicer profiles, spool log filament context, and driver enrichment fixes — [upstream PR #100](https://github.com/Fire-Devils/filaman-system/pull/100) ✓

- **TypeScript / Astro type-safety cleanup (Batches 0–1 + 2 + 3–4)**
  - Backend + frontend baseline fixes — [fork PR #16](https://github.com/akira69/filaman-system/pull/16) → merged upstream as [PR #70](https://github.com/Fire-Devils/filaman-system/pull/70) ✓
  - Batch 1: list/detail pages — [fork PR #17](https://github.com/akira69/filaman-system/pull/17) → merged upstream as [PR #71](https://github.com/Fire-Devils/filaman-system/pull/71) ✓
  - Batch 2: filamentdb-lookup, spools/new — [fork PR #18](https://github.com/akira69/filaman-system/pull/18) → merged upstream as [PR #73](https://github.com/Fire-Devils/filaman-system/pull/73) ✓
  - Batch 3: spools/[id]/index + edit — [fork PR #19](https://github.com/akira69/filaman-system/pull/19) → merged upstream as [PR #74](https://github.com/Fire-Devils/filaman-system/pull/74) ✓
  - Batch 4: final 2 errors — [fork PR #20](https://github.com/akira69/filaman-system/pull/20) → merged upstream as [PR #75](https://github.com/Fire-Devils/filaman-system/pull/75) ✓

- **Column resize & reorder**
  - Drag-and-drop reorder on spools/filaments/manufacturers *(v1.2.7)*
  - Column edge resize, saved per browser *(v1.2.12)*

- **Dashboard filament count scope selector** — All / Active / Used selector landed directly in `main` (`579d199`), with translation and theme cleanup in `ef999d2`; the original goal of [fork PR #26](https://github.com/akira69/filaman-system/pull/26) is upstream ✓

- **Extra fields selectable in table views** — extended column picker with Standard/Extended/Extra Fields groups *(v1.1.18)*

- **SpoolmanDB plugin** — superseded; replaced by FilaManDB builtin plugin *(v1.2.2)*

- **SpoolmanDB language** — superseded; FilaManDB plugin has full i18n support *(v1.2.1)*

- **Firefox/Linux single-label browser print pagination fix** — merged upstream as [PR #107](https://github.com/Fire-Devils/filaman-system/pull/107) ✓

- **Single-label print help and additional small-label hardening** — compact hover/focus print-help tooltip, advanced-template writing-aid controls, and removal of screen overflow from the single-label print layout to prevent a trailing blank page — released on upstream `main` in v1.2.29 via [PR #115](https://github.com/Fire-Devils/filaman-system/pull/115) ✓

- **Database-backed label presets** — per-user spool, filament, and label-paper presets with one-time browser migration, exact-name semantics, backup/restore support, and concurrency-safe item mutations — [fork PR #36](https://github.com/akira69/filaman-system/pull/36) → merged upstream as [PR #116](https://github.com/Fire-Devils/filaman-system/pull/116) and released in v1.2.33 ✓

- **Rich field types for extra fields** — `range`, `date`, `url`, `multiselect`, `textarea`; `number` with bounds/unit/decimal config; shared form, display, and printing support — merged upstream as [PR #117](https://github.com/Fire-Devils/filaman-system/pull/117) and released in v1.2.34 *(clean successor to merged/reverted fork PR #22)* ✓

- **Entity-specific typed extra fields** — record-local spool/filament field definitions with types (including datetime), units, choices, bounds, shared rendering, clearer “Spool-specific” / “Filament-specific” UI — [fork PR #41](https://github.com/akira69/filaman-system/pull/41) → merged upstream as [PR #120](https://github.com/Fire-Devils/filaman-system/pull/120) and released in v1.2.35 ✓

- **Spoolman rich-field import and legacy repair** — choose System, record-specific, raw-preserved, or legacy-cleaned storage globally and per field; safely promote earlier imports into typed fields without overwriting native or incompatible retained values — [fork PR #38](https://github.com/akira69/filaman-system/pull/38) → merged upstream as [PR #132](https://github.com/Fire-Devils/filaman-system/pull/132) and released in v1.2.43 ✓

- **Alpha color support** — CSS-compatible 4-channel color support (`#RRGGBBAA`) across color storage, APIs, shared color editors, swatches, labels, devices, and plugins; opacity UI with checkerboard preview; Spoolman transparency repair — [fork PR #7](https://github.com/akira69/filaman-system/pull/7) → merged upstream as [PR #124](https://github.com/Fire-Devils/filaman-system/pull/124) and released in v1.2.36 ✓; supersedes the narrower Spoolman app import fix [PR #6](https://github.com/akira69/filaman-system/pull/6)

- **Smart table filters and visual color filtering** — the original [fork PR #35](https://github.com/akira69/filaman-system/pull/35) grew into shared, type-aware header filters for Filaments, Spools, Manufacturers, and Manage Colors plus the New Filament palette; database-backed suggestions, spool-status scoping, System Extra Field filtering, searchable color grids, editable chromatic/neutral ranges, transparency handling, and English/German UI — merged upstream as [PR #168](https://github.com/Fire-Devils/filaman-system/pull/168) and released in [v1.3.6](https://github.com/Fire-Devils/filaman-system/releases/tag/v1.3.6) ✓

- **Selectable manufacturer-logo table columns** — dedicated, bounded logo columns on Manufacturers, Filaments, and Spools; independently hideable, reorderable, and resizable with transparency and fallback handling — [fork PR #10](https://github.com/akira69/filaman-system/pull/10) → merged upstream as [PR #165](https://github.com/Fire-Devils/filaman-system/pull/165) and released in v1.3.6 ✓

- **Device administration and control hardening** — HTTP-compatible enrollment-code copying, complete paginated device loading, native accessible dialogs, protected credential material, authenticated callbacks, explicit control permissions, and validated outbound device targets — merged upstream as [PR #162](https://github.com/Fire-Devils/filaman-system/pull/162) and released in v1.3.6 ✓

- **AMS View redesign** — renamed and rebuilt the Display board with printer filtering, responsive AMS layouts, kiosk support, canonical external bays, spool links, richer tray data, matching humidity/temperature display, and populated unlinked HT bays — merged upstream as [PR #160](https://github.com/Fire-Devils/filaman-system/pull/160) and [PR #161](https://github.com/Fire-Devils/filaman-system/pull/161), released in v1.3.3 and v1.3.6 ✓

- **September inventory and integration improvements** — released in v1.2.49–v1.3.5: spool search across IDs and extra fields, bulk spool-status changes, dual RFID slots and safer weigh-to-assign behavior, tag color matching, the read-only Display API, idempotent Bambuddy consumption events, sidebar update notifications, and QR display for newly created API keys ✓

- **Color-alpha migration test fixture repair** — synthetic color rows now include the model's required timestamps; released in v1.2.50 with production migration behavior unchanged ✓

- **SpoolmanAPI plugin — AFC/BoxTurtle null color serialization fix** — merged in the plugin repository as [PR #3](https://github.com/Fire-Devils/filaman-spoolmanapi-plugin/pull/3) ✓

---

## 🔁 In Progress for Upstream Merge

Fork PRs that are code-complete or in active development, targeting submission to Fire-Devils/filaman-system (or the relevant plugin repo).

### Recommended upstream submission queue

Keep only one substantive PR open upstream at a time. Submit the next PR only after the previous one is merged or the maintainer explicitly parks it, and rebase every successor onto the resulting `devel`.

1. **[PR #28](https://github.com/akira69/filaman-system/pull/28) — Windows development startup lock**
   - Submit after native Windows or Windows-CI confirmation.
2. **[PR #8](https://github.com/akira69/filaman-system/pull/8) — multicolor hero shading**
   - Rebase onto v1.2.36 (PR #7's alpha color foundation is already upstream as [#124](https://github.com/Fire-Devils/filaman-system/pull/124)) and collapse the temporary duplicate color helper into the upstream shared utility.
3. **[PR #21](https://github.com/akira69/filaman-system/pull/21) — formula extra fields**
   - Submit alone after the preceding PRs. Rebase its migration so it follows the entity-specific fields revision instead of also branching directly from `c9f2a1e4b7d3`.
4. **[PR #9](https://github.com/akira69/filaman-system/pull/9) — manufacturer logo upload overrides**
   - Ask for upstream interest first because remote URL fetching and uploads require a heavier security review.

Hold **[PR #24](https://github.com/akira69/filaman-system/pull/24)** for an upstream architecture discussion and retarget it from `main` to `devel` if accepted. Reassess **[PR #26](https://github.com/akira69/filaman-system/pull/26)** before submission because its core dashboard selector already landed upstream; submit only the still-wanted card expansion.

- **SpoolmanAPI plugin — alpha-color export compatibility** — [plugin PR #4](https://github.com/Fire-Devils/filaman-spoolmanapi-plugin/pull/4) *(draft; targets the plugin repo)* — strips trailing alpha from `#RRGGBBAA` so Spoolman/AFC consumers continue receiving six-character `RRGGBB`

- **Plugin-view shell page** — embed integration SPAs (e.g. spoolmanapi admin UI) inside FilaMan nav — [PR #24](https://github.com/akira69/filaman-system/pull/24)

- **Dashboard filament scope expansion** — apply the existing All / Active / Used selection to the Filament Types and Filament Statistics cards — [PR #26](https://github.com/akira69/filaman-system/pull/26) *(the core count selector is already in `main`)*

- **Windows development startup lock** — platform-aware non-blocking worker lock using `msvcrt` on native Windows while preserving POSIX behavior — [PR #28](https://github.com/akira69/filaman-system/pull/28)

- **Multicolor / hero shading** on filament and spool detail pages — [PR #8](https://github.com/akira69/filaman-system/pull/8) *(system repo; frontend-only, no plugin impact)*

- **Manufacturer logo upload overrides** — per-manufacturer custom logo upload — [PR #9](https://github.com/akira69/filaman-system/pull/9)

- **Formula field / extra fields JSON** *(Spoolman basis PR #885)* — derived values computed from JSON Logic expressions; full backend operator library (math, text, date/time), CodeMirror editor, field references, live preview — [PR #21](https://github.com/akira69/filaman-system/pull/21) *(rebased onto `upstream/devel` v1.2.34 at `d365964d`; six unique commits; clean and mergeable; 604 backend and 97 frontend tests pass)*

---

## 🛠 In Development

Active development — implementation underway but not yet at PR stage.

- **Manufacturer logo sync plugin** *(Spoolman basis PR #872)* — [implementation plan](./_pr_artifacts/manufacturer-logo-sync/plan.md)
  - **Variant A** (`feat/logo-custom-sync`) — re-sync logos from FilamentDB on demand; adds `filamentdb_slug` + `logo_source` to `Manufacturer`; admin bulk-sync panel
  - **Variant B** (`feat/filamandb-logo-submit`) — submit logo contributions back to FilaManDB from within the app; Track 1: GitHub issue deep-link workflow; Track 2: direct API (pending upstream)

---

## 📋 Planned

- **Expose `stocked_in_at` in the spool UI** — keep the existing printable token, add a visible/editable spool field, and define when new spools populate it; do not silently change existing timestamp values.

- **Built-in import plugin lifecycle consistency** — define and document what the Active toggle controls for Spoolman Import and FilamentDB, then align UI and route behavior without silently breaking existing import API clients; keep importers bundled until the plugin platform supports optional frontend pages and route registration cleanly

- **Docker build-context cleanup** — exclude backend tests and other development-only files from the production image; prefer this general packaging cleanup over splitting the small, on-demand Spoolman importer out of the standard installation

- **Global action button icons** — replace all inline-style text Edit/Delete/View buttons with `fm-btn-icon` icon buttons UI-wide (10 table pages + 3 detail pages) — [implementation plan](./_pr_artifacts/action-button-icons/plan.md)

- **Advanced label designer typography controls** — add a proper label typography section near the existing title/info size controls. Font choices should be controlled per text area/section, not token-by-token:
  - Title font
  - Secondary title font
  - Info font
  - Info 2 font
  - Start with a small safe font set: default/system sans, condensed sans, mono, and rounded/display only if it prints cleanly
  - Persist font choices in designer settings and apply them in preview/print rendering

### Code de-duplication
Executive summary
The project has about 65,200 maintained source/test lines:
Frontend: 36,334
Backend: 21,579
Backend tests: 7,308
Using jscpd 5.0.12 with an 8-line/50-token strict threshold:
Area	Clone pairs	Tool-reported duplicated lines	Duplication
Frontend	246	4,772 parser-lines	5.37%*
Backend	107	1,311	6.40%
Backend tests	83	875	11.97%

* Astro files are parsed separately as HTML, JavaScript, TypeScript, and CSS, so frontend parser-line totals exceed physical lines. I excluded generated assets, node_modules, migrations, static bundles, and repository worktrees.
A realistic target is a net reduction of 3,400–5,100 lines, approximately 5–8% of maintained code, without changing behavior.
Recommended plan
Group 1 — Consolidate frontend form implementations
Priority: highest
Estimated reduction: 700–1,000 lines
The largest cluster is the filament create/edit pair:
[filaments/new.astro (line 402)](/Users/dfinch/Code/filaman-system/frontend/src/pages/filaments/new.astro:402)
[filaments/edit.astro (line 453)](/Users/dfinch/Code/filaman-system/frontend/src/pages/filaments/[id]/edit.astro:453)
These repeat color selection, manufacturer lookup, custom/system fields, field rendering, validation, and payload construction. jscpd found 22 clone blocks totaling 955 overlapping lines.
Actions:
Extract a filament-form-controller.ts containing:
Manufacturer/type/color loading
Color-grid state
System/custom-field serialization
Common validation
Shared payload construction

Extract shared Astro form sections for color, dimensions, spool defaults, temperature, and extra fields.

Pass a small mode adapter:
create versus edit
Initial values
POST versus PATCH
Success navigation

Apply the same domain-specific pattern to:
[spools/new.astro (line 315)](/Users/dfinch/Code/filaman-system/frontend/src/pages/spools/new.astro:315)
[spools/edit.astro (line 325)](/Users/dfinch/Code/filaman-system/frontend/src/pages/spools/[id]/edit.astro:325)

Avoid making one universal filament/spool form engine. Their shared primitives should be reusable, but their domain controllers should remain separate.
Group 2 — Create shared print-page runtimes — **completed upstream in v1.2.48**
Delivered by [PR #141](https://github.com/Fire-Devils/filaman-system/pull/141). The implementation centralized single/batch and filament/spool output coordination while keeping the four Astro routes as entity-specific adapters. See **Reliable selectable label printing and shared output pipeline** under Done for the released behavior and measured route reduction.
Group 3 — Extract list/table behavior
Priority: high
Estimated reduction: 550–850 lines
The filament and spool indexes repeat sorting, filtering, pagination, selection, bulk prompts, and row-state management:
[filaments/index.astro (line 214)](/Users/dfinch/Code/filaman-system/frontend/src/pages/filaments/index.astro:214)
[spools/index.astro (line 279)](/Users/dfinch/Code/filaman-system/frontend/src/pages/spools/index.astro:279)
Similar fragments occur in manufacturers, locations, colors, and spool log pages.
Actions:
Extract small utilities instead of a large table framework:
pagination.ts
sort-state.ts
selection-state.ts
modal-prompt.ts
filter-storage.ts

Create a configurable EntityTableController<T> only for common state transitions.

Leave domain-specific filtering and row rendering in each page through callbacks.

Consolidate repeated table/filter/pagination CSS into a shared stylesheet or Astro component.

Group 4 — Make backup operations registry-driven
Priority: high
Estimated reduction: 250–400 lines
[system.py (line 1383)](/Users/dfinch/Code/filaman-system/backend/app/api/v1/system.py:1383) is 2,401 lines. Its full/inventory export, delete, and import functions repeatedly define the same table order and loops.
Actions:
Define one declarative table registry containing:
Backup key
SQLAlchemy model
Inventory inclusion
Dependency order
Optional import transform

Derive:
Full export order
Inventory export order
Reverse deletion order
Full and inventory import order

Replace _export_all_data and _export_inventory_data with one filtered exporter.

Replace the paired delete/import loops similarly.

Represent special handling such as LabelPreset normalization as registry hooks.

Splitting system.py afterward would improve navigation, but moving code alone should not be counted as code reduction.
Group 5 — Consolidate backend endpoint pipelines
Priority: medium-high
Estimated reduction: 350–600 lines
Strong backend clusters exist in:
[spools.py (line 350)](/Users/dfinch/Code/filaman-system/backend/app/api/v1/spools.py:350)
[printers.py (line 642)](/Users/dfinch/Code/filaman-system/backend/app/api/v1/printers.py:642)
[filaments.py (line 1207)](/Users/dfinch/Code/filaman-system/backend/app/api/v1/filaments.py:1207)
[admin.py (line 160)](/Users/dfinch/Code/filaman-system/backend/app/api/v1/admin.py:160)
Actions:
Spools:
Share single/bulk creation preparation
Centralize cascading filament defaults
Centralize RFID conflict handling
Use one event-recording helper for measurement, adjustment, consumption, status, and move actions

Printer drivers:
Share printer/driver lookup, permission checks, invocation, error translation, and proxy-to-primary handling
Parameterize start/stop and related driver operations

Slicer profiles:
Share default/model profile validation and persistence between spools and filaments

CRUD plumbing:
Add focused get_or_404 and conflict helpers
Do not introduce a generic repository layer merely to shorten endpoints

Group 6 — Share import-service primitives
Priority: medium
Estimated reduction: 100–180 lines
The FilamentDB and Spoolman import services duplicate error/result structures plus manufacturer, color, and filament import mechanics:
[filamentdb_import_service.py (line 986)](/Users/dfinch/Code/filaman-system/backend/app/services/filamentdb_import_service.py:986)
[spoolman_import_service.py (line 452)](/Users/dfinch/Code/filaman-system/backend/app/services/spoolman_import_service.py:452)
Actions:
Extract common result counters and import-error base types.
Share color loading/upsert logic.
Share manufacturer lookup/create mechanics through source adapters.
Keep source interpretation and matching rules in their current services.
This should follow the backup and endpoint work because its semantic differences make it a riskier abstraction.
Group 7 — Reduce admin-page scaffolding
Priority: medium
Estimated reduction: 200–350 lines
Admin pages repeat form CSS, headers, loading/error state, API save flows, delete confirmation, and modal handling. Examples include app settings, OIDC, users, roles, devices, colors, and extra fields.
Actions:
Add shared admin page/header/form components.
Extract standard API-form submit and error rendering helpers.
Reuse a confirmation modal and table empty/loading state.
Move repeated admin form CSS into one stylesheet.
Group 8 — Parameterize backend tests
Priority: medium
Estimated reduction: 350–550 lines
Tests have the highest measured duplication at 11.97%, concentrated in:
[test_spools.py (line 310)](/Users/dfinch/Code/filaman-system/backend/tests/test_spools.py:310)
[test_devices.py (line 219)](/Users/dfinch/Code/filaman-system/backend/tests/test_devices.py:219)
[test_filaments.py (line 121)](/Users/dfinch/Code/filaman-system/backend/tests/test_filaments.py:121)
[test_plugin_service.py (line 86)](/Users/dfinch/Code/filaman-system/backend/tests/test_plugin_service.py:86)
Actions:
Add factories for users, filaments, spools, devices, and authenticated clients.
Parameterize repeated create/update/delete permission matrices.
Build reusable response assertions.
Consolidate repeated plugin ZIP and import-service setup.
Only extract setup and assertion mechanics; retain named tests when their business intent differs.
Recommended execution order
Add deduplication baseline and characterization coverage.
Consolidate filament/spool forms.
Extract table/list utilities.
Introduce the backend backup registry.
Consolidate spool and printer endpoint pipelines.
Share import primitives and admin-page scaffolding.
Parameterize tests and run the final duplication pass.
Each pull request should stay within one workflow and aim for roughly 200–700 net removed lines.
Definition of done for every group
Net production-line reduction is recorded.
No API request/response schemas change unintentionally.
npm run check, npm run lint, and npm run build pass.
Backend pytest passes.
Create/edit and print workflows receive browser smoke coverage.
jscpd reports no new clone clusters.
The abstraction has fewer concepts than the duplicated implementations it replaces.
Generated static bundles, migrations, and worktrees should remain excluded from all deduplication gates. No repository files were changed during this analysis.
---

## 🅿️ Parking Lot

Ideas worth revisiting but not actively prioritised.

- **Filament-swatch plugin** — integrate filament-swatch into FilaMan; depends on upstream plugin API stability

- **Filament & Spool page layout/formatting editor** — a visual admin tool for defining how fields are arranged and sized on filament and spool detail/edit pages (field order, column spans, section groupings, label overrides per-page); depends on a `sort_order` column on system extra fields and a richer field-config schema
