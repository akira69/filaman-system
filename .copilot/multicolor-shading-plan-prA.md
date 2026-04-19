# Plan: PR A — Multi-color shading for spool and filament pages

## Goal

Extract the still-useful visual part of old PR #4 into a new standalone PR that makes spool and filament pages shade according to the configured filament colors.

This PR should be based directly on the latest `main` and should stay independent from manufacturer logo work.

## Why this PR exists

Upstream logo support makes most of PR #4 redundant, but the multi-color hero/card treatment is still valuable because it:
- makes `single` vs `multi` filament setups visually obvious
- distinguishes `striped` and `gradient` styles at a glance
- reuses data the app already stores (`color_mode`, `multi_color_style`, ordered `colors`)

## Recommended branch basis

- Sync fork `main` to the latest upstream `main`
- Create a fresh branch from that updated `main`
- Suggested name: `feat/multicolor-hero-shading`

## Scope

### Include
- **Spool detail page**
  - tint the filament hero/info card from the filament's configured colors
  - for `single` color: soft single-color tint
  - for `multi + striped`: segmented bands
  - for `multi + gradient`: blended gradient tint
- **Filament detail page**
  - apply the same visual treatment consistently
- **Shared frontend helper**
  - build safe CSS backgrounds from the filament color list and style mode
  - preserve readable text contrast on dark/light themes
- **Small preview consistency improvements** where they naturally fit
  - keep dots/swatches aligned with the hero/card treatment

### Deliberately excluded
- manufacturer logo upload/import/override flows
- backend schema or API changes unless a tiny helper exposure is required
- print/export changes
- unrelated UI cleanup from old PR #4

## Design decisions

- Keep the hero/card tint **subtle**. The dot/swatch remains the strongest true-color indicator.
- Reuse the existing alpha-aware color handling so translucent colors remain softer instead of producing overly strong tints.
- Keep the implementation **frontend-only** if the existing filament payload already provides all required color data.
- Prefer a shared helper in `frontend/src/lib/colors.ts` or a nearby dedicated utility instead of duplicating gradient logic across pages.

## Candidate files

- `frontend/src/lib/colors.ts`
- `frontend/src/pages/filaments/[id]/index.astro`
- `frontend/src/pages/spools/[id]/index.astro`
- optionally:
  - `frontend/src/pages/spools/index.astro`
  - `frontend/src/pages/filaments/index.astro`
  - `frontend/src/styles/global.css`

## Implementation phases

1. **Add a shared card-background helper**
   - derive a safe CSS background from one or more filament colors
   - support:
     - single color tint
     - striped hard stops
     - gradient blend
   - keep alpha-aware handling consistent with current `toCssColor(...)`

2. **Update filament detail page**
   - replace plain/neutral hero background with the new helper-driven tint
   - keep existing color labels and small swatches visible

3. **Update spool detail page**
   - apply the same tint logic to the filament info card on the spool page
   - ensure multi-color spools look clearly different from single-color spools

4. **Polish contrast and fallback behavior**
   - no-color fallback should remain neutral
   - long names should still wrap cleanly
   - border/outline should remain visible even for pale colors

## Main risks

- overly saturated or noisy backgrounds reducing text readability
- inconsistent stripe direction or gradient direction between pages
- multi-color cards becoming visually busy when many colors are attached
- translucent colors producing a tint that is too faint to notice

## Validation targets

- `cd frontend && cp ../version.txt ./version.txt && npm run build && rm -f ./version.txt`
- verify **single-color** filament hero tint
- verify **striped** multi-color hero tint
- verify **gradient** multi-color hero tint
- verify neutral fallback when no colors exist
- verify dark/light theme contrast stays readable

## Suggested PR title

`feat(ui): add multi-color shading to spool and filament detail cards`

## Suggested close note for PR #4

> Closing this as superseded for the logo portion now that upstream has manufacturer logo support. The remaining multi-color hero shading work is being re-opened as a smaller standalone PR based on current `main`.
