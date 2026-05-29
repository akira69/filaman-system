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
  - Batch 2: filamentdb-lookup, spools/new — [fork PR #18](https://github.com/akira69/filaman-system/pull/18) closed → merged upstream as [PR #73](https://github.com/Fire-Devils/filaman-system/pull/73) ✓

- **Column resize & reorder**
  - Drag-and-drop reorder on spools/filaments/manufacturers *(v1.2.7)*
  - Column edge resize, saved per browser *(v1.2.12)*

- **Extra fields selectable in table views** — extended column picker with Standard/Extended/Extra Fields groups *(v1.1.18)*

- **SpoolmanDB plugin** — superseded; replaced by FilaManDB builtin plugin *(v1.2.2)*

- **SpoolmanDB language** — superseded; FilaManDB plugin has full i18n support *(v1.2.1)*

---

## 🔁 In Progress for Upstream Merge

Fork PRs that are code-complete or in active development, targeting submission to Fire-Devils/filaman-system.

- **Filament label printing** *(Spoolman basis PR #846)* — [PR #1](https://github.com/akira69/filaman-system/pull/1) *(open; upstream has spool label printing only)*

- **Label export workflow** — PNG/AML *(Spoolman basis PR #860)* — [PR #3](https://github.com/akira69/filaman-system/pull/3) *(open; upstream PNG export is spool-only)*

- **Spoolman app import fix** — alpha hex color import bug — [PR #6](https://github.com/akira69/filaman-system/pull/6)

- **Alpha color support** — 4-channel RGBA hex foundation for filaments — [PR #7](https://github.com/akira69/filaman-system/pull/7)

- **Multicolor / hero shading** on filament and spool detail pages — [PR #8](https://github.com/akira69/filaman-system/pull/8)

- **Manufacturer logo upload overrides** — per-manufacturer custom logo upload — [PR #9](https://github.com/akira69/filaman-system/pull/9)

- **Move manufacturer logo to dedicated DB column** — [PR #10](https://github.com/akira69/filaman-system/pull/10)

- **Advanced label designer** — rich per-field template placement and editing on print page — [PR #14](https://github.com/akira69/filaman-system/pull/14)
  - Sub-task: template field selector (simple vs detail view)

- **Formula field / extra fields JSON** *(Spoolman basis PR #885)* — derived values computed from JSON Logic expressions; full backend operator library (math, text, date/time), CodeMirror editor, field references, live preview — [PR #21](https://github.com/akira69/filaman-system/pull/21)

- **Rich field types for extra fields** — add `range`, `date`, `url`, `multiselect`, `textarea` types; `number` updated with bounds/unit/decimal config; matches and extends Spoolman's type set — [PR #22](https://github.com/akira69/filaman-system/pull/22)

---

## 🛠 In Development

Active development — implementation underway but not yet at PR stage.

- **Manufacturer logo sync plugin** *(Spoolman basis PR #872)* — [implementation plan](./_pr/manufacturer-logo-sync/plan.md)
  - **Variant A** (`feat/logo-custom-sync`) — re-sync logos from FilamentDB on demand; adds `filamentdb_slug` + `logo_source` to `Manufacturer`; admin bulk-sync panel
  - **Variant B** (`feat/filamandb-logo-submit`) — submit logo contributions back to FilaManDB from within the app; Track 1: GitHub issue deep-link workflow; Track 2: direct API (pending upstream)

---

## 📋 Planned

- **Global action button icons** — replace all inline-style text Edit/Delete/View buttons with `fm-btn-icon` icon buttons UI-wide (10 table pages + 3 detail pages) — [implementation plan](./_pr/action-button-icons/plan.md)

---

## 🅿️ Parking Lot

Ideas worth revisiting but not actively prioritised.

- **Filament-swatch plugin** — integrate filament-swatch into FilaMan; depends on upstream plugin API stability

- **Filament & Spool page layout/formatting editor** — a visual admin tool for defining how fields are arranged and sized on filament and spool detail/edit pages (field order, column spans, section groupings, label overrides per-page); depends on a `sort_order` column on system extra fields and a richer field-config schema
