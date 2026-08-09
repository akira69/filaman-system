# Roadmap

_Last reconciled with GitHub state on 2026-08-08._

## ✅ Done — upstream (Fire-Devils/filaman-system)

Features implemented upstream, including fork contributions accepted there.

**Label printing & design**

- **Filament label printing** *(Spoolman basis PR #846)* — [fork PR #1](https://github.com/akira69/filaman-system/pull/1) closed → upstream [PR #26](https://github.com/Fire-Devils/filaman-system/pull/26) ✓; extended by upstream [PR #91](https://github.com/Fire-Devils/filaman-system/pull/91) ✓

- **Advanced label designer** — rich per-field template placement and editing on print page — [fork PR #14](https://github.com/akira69/filaman-system/pull/14) → upstream [PR #80](https://github.com/Fire-Devils/filaman-system/pull/80) ✓
  - Sub-task: template field selector (simple vs detail view)

- **Label modifier chips** — quick-insert token modifiers (`**bold**`, `*italic*`, `__underline__`, `==inverse==`, `@@filament inverse@@`, `^^caps^^`) — [fork PR #32](https://github.com/akira69/filaman-system/pull/32) → upstream [PR #84](https://github.com/Fire-Devils/filaman-system/pull/84) ✓

- **Unified spool label designer + PNG/PDF exports** — [fork PR #34](https://github.com/akira69/filaman-system/pull/34) closed → upstream [PR #90](https://github.com/Fire-Devils/filaman-system/pull/90) ✓; label export workflow [fork PR #3](https://github.com/akira69/filaman-system/pull/3) closed, superseded

- **Label presets persisted in the database** — [fork PR #36](https://github.com/akira69/filaman-system/pull/36) → upstream [PR #116](https://github.com/Fire-Devils/filaman-system/pull/116) ✓

- **Single-label pagination & trailing blank page fixes** — [fork PR #37](https://github.com/akira69/filaman-system/pull/37) / [#39](https://github.com/akira69/filaman-system/pull/39) → upstream [PR #107](https://github.com/Fire-Devils/filaman-system/pull/107), [PR #115](https://github.com/Fire-Devils/filaman-system/pull/115) ✓

- **Spool label location rendering fix** — upstream [PR #119](https://github.com/Fire-Devils/filaman-system/pull/119) ✓

- **Label-paper sheet printing** — upstream [PR #95](https://github.com/Fire-Devils/filaman-system/pull/95) ✓

- **Browser print sizing / orientation fixes** — upstream [PR #88](https://github.com/Fire-Devils/filaman-system/pull/88), [PR #94](https://github.com/Fire-Devils/filaman-system/pull/94) ✓

**Colors**

- **Alpha color support** — 4-channel RGBA hex (`#RRGGBBAA`) across color storage, editors, swatches, labels + Spoolman transparency repair — [fork PR #7](https://github.com/akira69/filaman-system/pull/7) closed → upstream [PR #124](https://github.com/Fire-Devils/filaman-system/pull/124) ✓ *(v1.2.36)*

- **Spoolman alpha hex import fix** — [fork PR #6](https://github.com/akira69/filaman-system/pull/6) closed; upstream [issue #44](https://github.com/Fire-Devils/filaman-system/issues/44) resolved

**Extra fields**

- **Rich extra field types** — Number, Range, Date, URL, Multi-select, Textarea — [fork PR #22](https://github.com/akira69/filaman-system/pull/22) → upstream [PR #117](https://github.com/Fire-Devils/filaman-system/pull/117) ✓; ref [issue #59](https://github.com/Fire-Devils/filaman-system/issues/59) (closed)

- **Typed filament- and spool-specific extra fields** — [fork PR #41](https://github.com/akira69/filaman-system/pull/41) → upstream [PR #120](https://github.com/Fire-Devils/filaman-system/pull/120) ✓

- **Extra fields selectable in table views** — extended column picker with Standard/Extended/Extra Fields groups *(v1.1.18)*; ref [issue #9](https://github.com/Fire-Devils/filaman-system/issues/9)

**Manufacturers**

- **Manufacturer logo support** *(Spoolman basis PR #857)* — upstream v1.2.1; [fork PR #4](https://github.com/akira69/filaman-system/pull/4) closed

- **Material filter deduplication** — [fork PR #5](https://github.com/akira69/filaman-system/pull/5) → upstream [PR #29](https://github.com/Fire-Devils/filaman-system/pull/29) ✓; ref [issue #6](https://github.com/Fire-Devils/filaman-system/issues/6)

**Tables & performance**

- **Server-side spool count sort** — [fork PR #13](https://github.com/akira69/filaman-system/pull/13) → upstream [PR #53](https://github.com/Fire-Devils/filaman-system/pull/53) ✓

- **Column resize & reorder** — drag-and-drop reorder *(v1.2.7)*; column edge resize *(v1.2.12)*; ref [issue #58](https://github.com/Fire-Devils/filaman-system/issues/58)

- **Speed up screen refresh** — async dashboard and list load; independently fixed upstream; ref [issue #42](https://github.com/Fire-Devils/filaman-system/issues/42), [#46](https://github.com/Fire-Devils/filaman-system/issues/46)
  - Dashboard async session concurrency fix — [fork PR #2](https://github.com/akira69/filaman-system/pull/2) *(upstream `d41ae3c`)*
  - FilamentDB sync UI performance — [fork PR #12](https://github.com/akira69/filaman-system/pull/12) *(upstream `8b35ce9`)*
  - FilamentDB stale color position collision fix — [fork PR #11](https://github.com/akira69/filaman-system/pull/11) *(upstream `babba6b`)*

**Search & code quality**

- **FilaManDB filament search fuzzy matching** — lookup fallback for punctuated/catalog variants — [fork PR #31](https://github.com/akira69/filaman-system/pull/31) → upstream [PR #85](https://github.com/Fire-Devils/filaman-system/pull/85) ✓

- **TypeScript / Astro type-safety cleanup (all batches)** — 433 → 0 errors; fork PRs [#16](https://github.com/akira69/filaman-system/pull/16), [#17](https://github.com/akira69/filaman-system/pull/17), [#18](https://github.com/akira69/filaman-system/pull/18), [#19](https://github.com/akira69/filaman-system/pull/19), [#20](https://github.com/akira69/filaman-system/pull/20) → upstream [PR #70](https://github.com/Fire-Devils/filaman-system/pull/70), [#71](https://github.com/Fire-Devils/filaman-system/pull/71), [#73](https://github.com/Fire-Devils/filaman-system/pull/73), [#74](https://github.com/Fire-Devils/filaman-system/pull/74), [#75](https://github.com/Fire-Devils/filaman-system/pull/75) ✓

**Superseded**

- **SpoolmanDB plugin** — replaced by FilaManDB builtin plugin *(v1.2.2)*

- **SpoolmanDB language** — superseded; FilaManDB plugin has full i18n support *(v1.2.1)*

---

## 🔄 In Progress

Fork PRs in active development or awaiting upstream review.

- **Spoolman rich field import** — choose and repair Spoolman extra field storage on import — [PR #38](https://github.com/akira69/filaman-system/pull/38) *(rebased onto v1.2.36; full live smoke test against a real Spoolman instance passed 2026-08-08)*

- **Formula field / extra fields JSON** *(Spoolman basis PR #885)* — derived values computed from JSON Logic expressions; full backend operator library, CodeMirror editor, field references, live preview — [PR #21](https://github.com/akira69/filaman-system/pull/21)

- **Multicolor / hero shading** on filament and spool detail pages — [PR #8](https://github.com/akira69/filaman-system/pull/8)

- **Column-header smart filters** — type-aware filters on every table data column — [PR #35](https://github.com/akira69/filaman-system/pull/35)

- **Dashboard filament count scope selector** — All / Active / Used — [PR #26](https://github.com/akira69/filaman-system/pull/26); ref [issue #65](https://github.com/Fire-Devils/filaman-system/issues/65)

- **Manufacturer logo upload overrides** — per-manufacturer custom logo upload — [PR #9](https://github.com/akira69/filaman-system/pull/9)

- **Move manufacturer logo to dedicated DB column** — [PR #10](https://github.com/akira69/filaman-system/pull/10) *(upstream rebase in progress)*

- **Windows startup lock support** — [PR #28](https://github.com/akira69/filaman-system/pull/28)

- **Deterministic ordering for extra fields** — [PR #42](https://github.com/akira69/filaman-system/pull/42)

- **Filament-swatch plugin** — embed [spoolman-filament-swatch](https://github.com/Disane87/spoolman-filament-swatch) into FilaMan as a first-party plugin:
  - Plugin shell page (`/plugin-view/[slug]`) — [fork PR #24](https://github.com/akira69/filaman-system/pull/24)
  - SpoolmanAPI HTTP routes — [fork PR #23](https://github.com/akira69/filaman-system/pull/23) closed, superseded by [filaman-spoolmanapi-plugin](https://github.com/Fire-Devils/filaman-spoolmanapi-plugin)
  - SPA hosted mode + Filaman plugin package — [akira69/spoolman-filament-swatch #6](https://github.com/akira69/spoolman-filament-swatch/pull/6), [#7](https://github.com/akira69/spoolman-filament-swatch/pull/7) *(pending upstream agreement with Disane87)*
  - Discussion: [Fire-Devils #41](https://github.com/Fire-Devils/filaman-system/discussions/41)

---

## 📤 Submitted Upstream (pending review/merge)

*(nothing currently pending)*

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

- **Label export workflow / AML** *(Spoolman basis PR #860)* — [PR #3](https://github.com/akira69/filaman-system/pull/3) closed; AML is the Labelife label printer native format — niche hardware, browser-print via label designer covers the general case

- **Filament & Spool page layout/formatting editor** — a visual admin tool for defining how fields are arranged and sized on filament and spool detail/edit pages (field order, column spans, section groupings, label overrides per-page); depends on a `sort_order` column on system extra fields and a richer field-config schema
