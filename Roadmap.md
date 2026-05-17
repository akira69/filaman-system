# Roadmap

## ✅ Done

- **Speed up screen refresh** — async dashboard and list load improvements
  - Dashboard async session concurrency fix — [PR #2](https://github.com/akira69/filaman-system/pull/2)
  - FilamentDB sync UI performance — [PR #12](https://github.com/akira69/filaman-system/pull/12)
  - FilamentDB stale color position collision fix — [PR #11](https://github.com/akira69/filaman-system/pull/11)

- **Filament label printing** *(Spoolman basis PR #846)* — [PR #1](https://github.com/akira69/filaman-system/pull/1)

- **Label export workflow** — PNG/AML export *(Spoolman basis PR #860)* — [PR #3](https://github.com/akira69/filaman-system/pull/3)

- **Manufacturer logo support** *(Spoolman basis PR #857)*
  - Base feature: logos on filament/spool pages — [PR #4](https://github.com/akira69/filaman-system/pull/4)
  - Logo upload overrides (per-manufacturer) — [PR #9](https://github.com/akira69/filaman-system/pull/9) *(open)*
  - Move logo to dedicated DB column — [PR #10](https://github.com/akira69/filaman-system/pull/10) *(open)*

- **Column resize & reorder**
  - Drag-and-drop reorder on spools/filaments/manufacturers *(upstream v1.2.7)*
  - Column edge resize, saved per browser *(upstream v1.2.12)*

- **Extra fields selectable in table views** — extended column picker with Standard/Extended/Extra Fields groups *(upstream v1.1.18)*

- **SpoolmanDB plugin** — superseded; replaced by FilaManDB builtin plugin *(upstream v1.2.2)*

- **SpoolmanDB language** — superseded; FilaManDB plugin has full i18n support *(upstream v1.2.1)*

---

## 🔄 In Progress

- **Advanced label designer** — rich per-field template placement and editing on print page — [PR #14](https://github.com/akira69/filaman-system/pull/14)
  - Sub-task: template field selector (simple vs detail view)

- **Spoolman app import fix** — alpha hex color import bug — [PR #6](https://github.com/akira69/filaman-system/pull/6)

- **Move list filtering to column headers**
  - Server-side spool count sort done — [PR #13](https://github.com/akira69/filaman-system/pull/13)

- **Alpha color support** — 4-channel RGBA hex foundation for filaments — [PR #7](https://github.com/akira69/filaman-system/pull/7)

- **Multicolor / hero shading** on filament and spool detail pages — [PR #8](https://github.com/akira69/filaman-system/pull/8)

- **TypeScript / Astro type-safety cleanup** — 433 → 0 errors
  - Backend + frontend baseline fixes — [PR #16](https://github.com/akira69/filaman-system/pull/16)
  - Batch 1: list/detail pages — [PR #17](https://github.com/akira69/filaman-system/pull/17)
  - Batch 2: filamentdb-lookup, spools/new — [PR #18](https://github.com/akira69/filaman-system/pull/18)
  - Batch 3: spools/[id]/index + edit — [PR #19](https://github.com/akira69/filaman-system/pull/19)
  - Batch 4: final 2 errors — [PR #20](https://github.com/akira69/filaman-system/pull/20)

---

## 📋 Planned

- **Filament-swatch plugin** — integrate filament-swatch into FilaMan

- **Manufacturer logo sync plugin** *(Spoolman basis PR #872)*
  - Related: logo upload overrides — [PR #9](https://github.com/akira69/filaman-system/pull/9)

- **Formula field / extra fields JSON** *(Spoolman basis PR #885)*

- **Global action buttons** — replace edit/delete text buttons with icons
