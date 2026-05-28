# Roadmap

## ✅ Done — this fork only

Work originated in this fork (akira69/filaman-system). Upstream may have independently implemented similar fixes.

- **Filament label printing** *(Spoolman basis PR #846)* — [PR #1](https://github.com/akira69/filaman-system/pull/1) *(open; upstream has spool label printing only)*

---

## ✅ Done — upstream (Fire-Devils/filaman-system)

Features implemented upstream, including fork contributions that were accepted there.

- **Manufacturer logo support** *(Spoolman basis PR #857)* — upstream v1.2.1; [fork PR #4](https://github.com/akira69/filaman-system/pull/4) closed
  - Logo upload overrides (per-manufacturer) — [PR #9](https://github.com/akira69/filaman-system/pull/9) *(open)*
  - Move logo to dedicated DB column — [PR #10](https://github.com/akira69/filaman-system/pull/10) *(open)*

- **Material filter deduplication** — [fork PR #5](https://github.com/akira69/filaman-system/pull/5) accepted upstream as [PR #29](https://github.com/Fire-Devils/filaman-system/pull/29) ✓

- **Server-side spool count sort** — [fork PR #13](https://github.com/akira69/filaman-system/pull/13) accepted upstream as [PR #53](https://github.com/Fire-Devils/filaman-system/pull/53) ✓

- **TypeScript / Astro type-safety cleanup (all batches)** — 433 → 0 errors
  - Backend + frontend baseline fixes — [fork PR #16](https://github.com/akira69/filaman-system/pull/16) → merged upstream as [PR #70](https://github.com/Fire-Devils/filaman-system/pull/70) ✓
  - Batch 1: list/detail pages — [fork PR #17](https://github.com/akira69/filaman-system/pull/17) → merged upstream as [PR #71](https://github.com/Fire-Devils/filaman-system/pull/71) ✓
  - Batch 2: filamentdb-lookup, spools/new — [fork PR #18](https://github.com/akira69/filaman-system/pull/18) → merged upstream as [PR #73](https://github.com/Fire-Devils/filaman-system/pull/73) ✓
  - Batch 3: spools/[id]/index + edit — [fork PR #19](https://github.com/akira69/filaman-system/pull/19) → merged upstream as [PR #74](https://github.com/Fire-Devils/filaman-system/pull/74) ✓
  - Batch 4: final 2 errors — [fork PR #20](https://github.com/akira69/filaman-system/pull/20) → merged upstream as [PR #75](https://github.com/Fire-Devils/filaman-system/pull/75) ✓

- **Column resize & reorder**
  - Drag-and-drop reorder on spools/filaments/manufacturers *(v1.2.7)*
  - Column edge resize, saved per browser *(v1.2.12)*

- **Extra fields selectable in table views** — extended column picker with Standard/Extended/Extra Fields groups *(v1.1.18)*

- **Advanced label designer** — rich per-field template placement and editing on print page *(v1.2.20)* — [fork PR #14](https://github.com/akira69/filaman-system/pull/14) → upstream [PR #80](https://github.com/Fire-Devils/filaman-system/pull/80) ✓
  - Sub-task: template field selector (simple vs detail view)

- **SpoolmanDB plugin** — superseded; replaced by FilaManDB builtin plugin *(v1.2.2)*

- **SpoolmanDB language** — superseded; FilaManDB plugin has full i18n support *(v1.2.1)*

- **Speed up screen refresh** — async dashboard and list load improvements; independently fixed upstream
  - Dashboard async session concurrency fix — [fork PR #2](https://github.com/akira69/filaman-system/pull/2) *(upstream `d41ae3c`)*
  - FilamentDB sync UI performance — [fork PR #12](https://github.com/akira69/filaman-system/pull/12) *(upstream `8b35ce9`)*
  - FilamentDB stale color position collision fix — [fork PR #11](https://github.com/akira69/filaman-system/pull/11) *(upstream `babba6b`)*

---

## 🔄 In Progress

- **Formula field / extra fields JSON** *(Spoolman basis PR #885)* — derived values computed from JSON Logic expressions; full backend operator library (math, text, date/time), CodeMirror editor, field references, live preview — branch `feat/formula-extra-fields`

- **Spoolman app import fix** — alpha hex color import bug — [PR #6](https://github.com/akira69/filaman-system/pull/6)

- **Move list filtering to column headers**
  - Server-side spool count sort done — [PR #13](https://github.com/akira69/filaman-system/pull/13)

- **Alpha color support** — 4-channel RGBA hex foundation for filaments — [PR #7](https://github.com/akira69/filaman-system/pull/7)

- **Multicolor / hero shading** on filament and spool detail pages — [PR #8](https://github.com/akira69/filaman-system/pull/8)

- **Filament-swatch plugin integration** — embed filament-swatch SPA inside FilaMan shell (sidebar + auth preserved via iframe); theme + language sync
  - FilaMan shell page (iframe embed) — [filaman-system PR #24](https://github.com/akira69/filaman-system/pull/24) *(open)*
  - FilaMan hosted mode in SPA — [akira69/spoolman-filament-swatch#6](https://github.com/akira69/spoolman-filament-swatch/pull/6) *(open)*; intended for upstream [Disane87/spoolman-filament-swatch](https://github.com/Disane87/spoolman-filament-swatch) (upstream PR #26 is Spoolman-only side)

- **Rich extra field types** — `range`, `float`, `date`, `url`, `multiselect`, `textarea`; `range` covers print/bed temp ranges, layer heights, etc. — [PR #22](https://github.com/akira69/filaman-system/pull/22) *(open)*; ref [upstream issue #59](https://github.com/Fire-Devils/filaman-system/issues/59) — [implementation plan](./_pr/rich-field-types/plan.md)

- **Dashboard filament count scope selector** — All / Active / Used scope toggle on dashboard counts — [PR #26](https://github.com/akira69/filaman-system/pull/26) *(open)*

---

## 📤 Submitted Upstream (pending review/merge)

*(nothing currently pending)*

---

## 📋 Planned

- **Manufacturer logo sync plugin** *(Spoolman basis PR #872)*
  - Related: logo upload overrides — [PR #9](https://github.com/akira69/filaman-system/pull/9)

- **Standard filament print-temp range fields** — add `extruder_temp_min/max_c` and `bed_temp_min/max_c` as first-class `Filament` model columns; sortable, filterable, visible in list views without extra-field setup; ref [upstream issue #59](https://github.com/Fire-Devils/filaman-system/issues/59) — depends on rich-field-types landing first (shares UI helper)

- **Global action button icons** — replace all inline-style text Edit/Delete/View buttons with `fm-btn-icon` icon buttons UI-wide (10 table pages + 3 detail pages) — [implementation plan](./_pr/action-button-icons/plan.md)

---

## 🅿️ Parking Lot

Ideas worth revisiting but not actively prioritised.

- **Label export workflow / AML** *(Spoolman basis PR #860)* — [PR #3](https://github.com/akira69/filaman-system/pull/3) *(closed)*; AML is the Labelife label printer native format — niche hardware, browser-print via label designer covers general case

- **Spoolman-compatible API plugin** (`spoolmanapi`) — [fork PR #23](https://github.com/akira69/filaman-system/pull/23) *(closed)* → upstream [PR #79](https://github.com/Fire-Devils/filaman-system/pull/79) *(draft)*; superseded by existing [filaman-spoolmanapi-plugin](https://github.com/Fire-Devils/filaman-spoolmanapi-plugin) (full CRUD, IP access control, CSV/JSON export)
