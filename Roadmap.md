[ ] 1) create plugin for filament-swatch to work in Filaman

[X] 2) speed up screen refresh from database read - is slow to populate
   - Dashboard async session concurrency fix: https://github.com/akira69/filaman-system/pull/2 [merged]
   - FilamentDB sync UI performance: https://github.com/akira69/filaman-system/pull/12 [merged]
   - FilamentDB stale color position collision fix: https://github.com/akira69/filaman-system/pull/11 [merged]

[X] 3) Add filament print PR (PR846 spoolman basis) : https://github.com/akira69/filaman-system/pull/1

[X] 4) Add label export workflow (PNG/AML) (PR860 spoolman basis) : https://github.com/akira69/filaman-system/pull/3

[X] 5) Add Manufacturer Logo inclusion and improvement to Label design & filament/spool show pages (PR857)
   - Base feature (logo on filament/spool pages): https://github.com/akira69/filaman-system/pull/4 [merged]
   - Logo upload overrides (per-manufacturer custom logos): https://github.com/akira69/filaman-system/pull/9 [open]
   - Move manufacturer logo into dedicated column: https://github.com/akira69/filaman-system/pull/10 [open]

   [ ] a) template text field instead of clicks (select "simple" vs "detail")
      - Advanced label designer (rich per-field layout): https://github.com/akira69/filaman-system/pull/14 [open]

[ ] 7) Add Plugin for manufacturer logo sync (PR872)
   - Related: logo upload overrides (partial): https://github.com/akira69/filaman-system/pull/9 [open]

[ ] 8) Add Formula field extra field capability JSON (PR885)

[ ] 9) Move spool & filament list filtering to columns
   - Server-side sort by spool count (partial step): https://github.com/akira69/filaman-system/pull/13 [merged]

[X] 10) column resize and reorder
   - Column drag & drop reorder on spools/filaments/manufacturers tables (upstream v1.2.7)
   - Column resize by dragging column edges, persisted per browser (upstream v1.2.12)

[ ] 11) global action buttons (edit/delete) from text to icons

[X] 12) extra fields as selectable in table views
   - Extended column picker groups Standard/Extended/Extra Fields; all extra fields sortable (upstream v1.1.18)

[X] 13) Spoolmandb plugin: superseded — replaced by FilaManDB builtin plugin (upstream v1.2.2)
   - Spoolman app import (alpha hex colors) is a separate fix: https://github.com/akira69/filaman-system/pull/6 [open]

[X] 14) Spoolmandb language: superseded — FilaManDB builtin plugin has full i18n support (upstream v1.2.1)

[ ] 15) Alpha color support foundation for filaments (4-channel RGBA hex)
   - https://github.com/akira69/filaman-system/pull/7 [open]

[ ] 16) Multicolor / hero shading on filament and spool detail pages
   - https://github.com/akira69/filaman-system/pull/8 [open]

[ ] 17) Advanced label designer — rich per-field placement and editing on print page
   - https://github.com/akira69/filaman-system/pull/14 [open]

[ ] 18) Frontend TypeScript / Astro type-safety baseline cleanup (433 → 0 errors)
   - Backend + frontend baseline fixes: https://github.com/akira69/filaman-system/pull/16 [open]
   - Frontend batch 1 (list/detail pages): https://github.com/akira69/filaman-system/pull/17 [open]
   - Frontend batch 2 (filamentdb-lookup, spools/new): https://github.com/akira69/filaman-system/pull/18 [open]
   - Frontend batch 3 (spools/[id]/index + edit): https://github.com/akira69/filaman-system/pull/19 [open]
   - Frontend batch 4 (final 2 errors): https://github.com/akira69/filaman-system/pull/20 [open]
