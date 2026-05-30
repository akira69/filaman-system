# Roadmap

## ✅ Done — upstream (Fire-Devils/filaman-system)

Features live in upstream, either merged from this fork or independently implemented there.

- **Speed up screen refresh** — async dashboard and list load improvements *(upstream independently implemented)*
  - Dashboard async session concurrency fix — [PR #2](https://github.com/akira69/filaman-system/pull/2) *(upstream independently fixed in `d41ae3c`)*
  - FilamentDB sync UI performance — [PR #12](https://github.com/akira69/filaman-system/pull/12) *(upstream independently fixed in `8b35ce9`)*
  - FilamentDB stale color position collision fix — [PR #11](https://github.com/akira69/filaman-system/pull/11) *(upstream independently fixed in `babba6b`)*

- **Manufacturer logo support** *(Spoolman basis PR #857)* — upstream v1.2.1; [fork PR #4](https://github.com/akira69/filaman-system/pull/4) closed

- **Material filter deduplication** — [fork PR #5](https://github.com/akira69/filaman-system/pull/5) accepted upstream as [PR #29](https://github.com/Fire-Devils/filaman-system/pull/29) ✓

- **Server-side spool count sort** — [fork PR #13](https://github.com/akira69/filaman-system/pull/13) accepted upstream as [PR #53](https://github.com/Fire-Devils/filaman-system/pull/53) ✓

- **TypeScript / Astro type-safety cleanup (Batches 0–1 + 3–4)**
  - Backend + frontend baseline fixes — [fork PR #16](https://github.com/akira69/filaman-system/pull/16) → merged upstream as [PR #70](https://github.com/Fire-Devils/filaman-system/pull/70) ✓
  - Batch 1: list/detail pages — [fork PR #17](https://github.com/akira69/filaman-system/pull/17) → merged upstream as [PR #71](https://github.com/Fire-Devils/filaman-system/pull/71) ✓
  - Batch 3: spools/[id]/index + edit — [fork PR #19](https://github.com/akira69/filaman-system/pull/19) → merged upstream as [PR #74](https://github.com/Fire-Devils/filaman-system/pull/74) ✓
  - Batch 4: final 2 errors — [fork PR #20](https://github.com/akira69/filaman-system/pull/20) → merged upstream as [PR #75](https://github.com/Fire-Devils/filaman-system/pull/75) ✓

- **Column resize & reorder**
  - Drag-and-drop reorder on spools/filaments/manufacturers *(v1.2.7)*
  - Column edge resize, saved per browser *(v1.2.12)*

- **Extra fields selectable in table views** — extended column picker with Standard/Extended/Extra Fields groups *(v1.1.18)*

- **SpoolmanDB plugin** — superseded; replaced by FilaManDB builtin plugin *(v1.2.2)*

- **SpoolmanDB language** — superseded; FilaManDB plugin has full i18n support *(v1.2.1)*

---

## 🔁 In Progress for Upstream Merge

Fork PRs that are code-complete or in active development, targeting submission to Fire-Devils/filaman-system.

- **Filament label printing** *(Spoolman basis PR #846)* — [PR #29](https://github.com/akira69/filaman-system/pull/29) *(draft; clean replacement for superseded [PR #1](https://github.com/akira69/filaman-system/pull/1); upstream has spool label printing only)*

- **Label export workflow** — PNG/AML *(Spoolman basis PR #860)* — [PR #3](https://github.com/akira69/filaman-system/pull/3) *(open; upstream PNG export is spool-only)*

- **Spoolman app import fix** — alpha hex color import bug — [PR #6](https://github.com/akira69/filaman-system/pull/6)

- **Alpha color support** — 4-channel RGBA hex foundation for filaments — [PR #7](https://github.com/akira69/filaman-system/pull/7)

- **Multicolor / hero shading** on filament and spool detail pages — [PR #8](https://github.com/akira69/filaman-system/pull/8)

- **Manufacturer logo upload overrides** — per-manufacturer custom logo upload — [PR #9](https://github.com/akira69/filaman-system/pull/9)

- **Move manufacturer logo to dedicated DB column** — [PR #10](https://github.com/akira69/filaman-system/pull/10)

- **Advanced label designer** — rich per-field template placement and editing on print page — [PR #14](https://github.com/akira69/filaman-system/pull/14)
  - Sub-task: template field selector (simple vs detail view)

- **TypeScript / Astro type-safety cleanup (Batch 2)** — rebased, awaiting upstream review
  - Batch 2: filamentdb-lookup, spools/new — [fork PR #18](https://github.com/akira69/filaman-system/pull/18) → submitted upstream as [PR #73](https://github.com/Fire-Devils/filaman-system/pull/73)

- **Formula field / extra fields JSON** *(Spoolman basis PR #885)* — derived values computed from JSON Logic expressions; full backend operator library (math, text, date/time), CodeMirror editor, field references, live preview — [PR #21](https://github.com/akira69/filaman-system/pull/21)

- **Rich field types for extra fields** — add `range`, `date`, `url`, `multiselect`, `textarea` types; `number` updated with bounds/unit/decimal config; matches and extends Spoolman's type set — [PR #22](https://github.com/akira69/filaman-system/pull/22)

- **Filament-swatch plugin** — embeds [spoolman-filament-swatch](https://github.com/Disane87/spoolman-filament-swatch) into FilaMan as a first-party plugin; requires changes on both repos:
  - **FilaMan side (this repo):**
    - Plugin shell page — generic `/plugin-view/[slug]` Astro page that wraps any iframe-able plugin, injects hosted-mode params, and syncs dark/light theme + locale automatically — [fork PR #24](https://github.com/akira69/filaman-system/pull/24)
    - SpoolmanAPI HTTP routes (Spoolman-compat layer exposed as real endpoints for the SPA's `/api/v2/` calls) — [fork PR #23](https://github.com/akira69/filaman-system/pull/23)
  - **spoolman-filament-swatch side** *(pending upstream agreement with Disane87)*:
    - SPA hosted mode extended to support Filaman alongside Spoolman — [fork PR #6](https://github.com/akira69/spoolman-filament-swatch/pull/6)
    - Filaman plugin package (FastAPI router, `plugin.json`, GitHub Actions release workflow) — [fork PR #7](https://github.com/akira69/spoolman-filament-swatch/pull/7)
  - Discussion: [Fire-Devils #41](https://github.com/Fire-Devils/filaman-system/discussions/41)

---

## 🛠 In Development

Active development — implementation underway but not yet at PR stage.

- **Manufacturer logo sync plugin** *(Spoolman basis PR #872)* — [implementation plan](./_pr/manufacturer-logo-sync/plan.md)
  - **Variant A** (`feat/logo-custom-sync`) — re-sync logos from FilamentDB on demand; adds `filamentdb_slug` + `logo_source` to `Manufacturer`; admin bulk-sync panel
  - **Variant B** (`feat/filamandb-logo-submit`) — submit logo contributions back to FilaManDB from within the app; Track 1: GitHub issue deep-link workflow; Track 2: direct API (pending upstream)

---

## 📋 Planned

- **Global action button icons** — replace all inline-style text Edit/Delete/View buttons with `fm-btn-icon` icon buttons UI-wide (10 table pages + 3 detail pages) — [implementation plan](./_pr/action-button-icons/plan.md)

- **Filament-swatch plugin** — see "In Progress for Upstream Merge" above

---

## 🅿️ Parking Lot

Ideas worth revisiting but not actively prioritised.

- **Filament & Spool page layout/formatting editor** — a visual admin tool for defining how fields are arranged and sized on filament and spool detail/edit pages (field order, column spans, section groupings, label overrides per-page); depends on a `sort_order` column on system extra fields and a richer field-config schema
