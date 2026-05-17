# Global Action Button Icons — Implementation Plan

> Status: Planned  
> Scope: All table/list row action buttons and detail page action buttons UI-wide

---

## Current state — two inconsistent patterns

### Pattern A — Inline-style text buttons (table rows, 10 pages)

Used wherever a row has Edit/Delete actions in a modal-driven table:

```html
<button class="btn-edit" style="color: var(--accent); background: none; border: none; cursor: pointer; margin-right: 8px;">Edit</button>
<button class="btn-delete" style="color: var(--error-text); background: none; border: none; cursor: pointer;">Delete</button>
```

Problems: raw `style` attributes on every instance; no hover state; no visual affordance; inconsistent spacing.

### Pattern B — `fm-btn` labeled buttons (detail pages, 3 pages)

```html
<a href="/spools/${id}/edit" class="fm-btn fm-btn-outline">Edit</a>
<button class="fm-btn fm-btn-danger">Delete</button>
```

These are fine as labeled buttons but benefit from an icon prefix for consistency.

### Pattern C — Bespoke inline-styled (admin/roles.astro)

Unique per-button inline styles not using `fm-btn` class — needs normalisation.

---

## Target state

### Table row actions → `fm-btn-icon`

The `.fm-btn-icon` class already exists in `global.css`. Replace all Pattern A buttons with it, dropping all inline `style` attributes:

```html
<button class="btn-edit fm-btn-icon fm-btn-icon--edit" data-id="..." title="Edit" aria-label="Edit">
  <svg width="16" height="16"><use href="/icons.svg#icon-action-edit"/></svg>
</button>
<button class="btn-delete fm-btn-icon fm-btn-icon--delete" data-id="..." title="Delete" aria-label="Delete">
  <svg width="16" height="16"><use href="/icons.svg#icon-action-delete"/></svg>
</button>
```

- `btn-edit` / `btn-delete` class names are **kept unchanged** — event listener setup (`querySelectorAll('.btn-edit')`) needs no change
- `data-*` attributes are unchanged
- `title` + `aria-label` carry the translatable label: `title="${t('common.edit')}"`

### Detail page actions → icon-prefixed labeled buttons

```html
<a href="/spools/${id}/edit" class="fm-btn fm-btn-outline">
  <svg width="14" height="14"><use href="/icons.svg#icon-action-edit"/></svg> Edit
</a>
<button class="fm-btn fm-btn-danger">
  <svg width="14" height="14"><use href="/icons.svg#icon-action-delete"/></svg> Delete
</button>
```

---

## Phase 1 — Infrastructure

### 1a. Add action icons to `frontend/public/icons.svg`

Add 5 new `<symbol>` entries (Lucide-style, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `fill="none"`):

| Symbol ID | Icon | SVG path summary |
|-----------|------|-----------------|
| `icon-action-edit` | Pencil | Square-with-pencil edit icon |
| `icon-action-delete` | Trash | Trash2 lid + body |
| `icon-action-view` | Eye | Eye circle + pupil |
| `icon-action-archive` | Archive | Box + lid |
| `icon-action-key` | Key-round | For "Reset Password" |

All symbols use `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` consistent with the existing inline SVGs in the codebase.

### 1b. Add color modifier classes to `frontend/src/styles/global.css`

Append after the existing `.fm-btn-icon:hover` rule:

```css
/* Action icon color variants */
.fm-btn-icon--edit {
  color: var(--accent);
  border-color: transparent;
}
.fm-btn-icon--edit:hover {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-soft));
  border-color: var(--accent);
  color: var(--accent);
}

.fm-btn-icon--delete {
  color: var(--error-text);
  border-color: transparent;
}
.fm-btn-icon--delete:hover {
  background: color-mix(in srgb, var(--error-text) 12%, var(--bg-soft));
  border-color: var(--error-text);
  color: var(--error-text);
}

.fm-btn-icon--view,
.fm-btn-icon--secondary {
  color: var(--text-muted);
  border-color: transparent;
}
.fm-btn-icon--view:hover,
.fm-btn-icon--secondary:hover {
  color: var(--text);
  background: var(--bg-elevated);
}
```

---

## Phase 2 — Page-by-page updates

### Table row action pages (Pattern A)

All these pages follow the same change: replace the two inline-style `<button>` elements with `fm-btn-icon` buttons. No JS changes needed — `.btn-edit`/`.btn-delete` class selectors are preserved.

| Page | Actions | Notes |
|------|---------|-------|
| `frontend/src/pages/admin/extra-fields.astro` | Edit, Delete | Plugin-managed rows keep the 🔒 span unchanged |
| `frontend/src/pages/admin/devices.astro` | Edit, Delete | |
| `frontend/src/pages/admin/users.astro` | Edit, Reset Password, Delete | Reset Password → `icon-action-key` + `fm-btn-icon--secondary` |
| `frontend/src/pages/admin/system.astro` | Details, Uninstall | Details → `icon-action-view`; Uninstall → `icon-action-delete` |
| `frontend/src/pages/admin/roles.astro` | Edit, Edit Permissions, Delete | Normalise to `fm-btn-icon` — drop all inline styles |
| `frontend/src/pages/printers/index.astro` | Edit, Delete | |
| `frontend/src/pages/locations/index.astro` | Edit, Delete | |
| `frontend/src/pages/filaments/colors.astro` | Edit, Delete | |
| `frontend/src/pages/manufacturers/index.astro` | Edit, Delete | Currently uses `fm-btn fm-btn-outline` / `fm-btn-danger` with inline size overrides — replace with `fm-btn-icon` |
| `frontend/src/pages/settings/api-keys.astro` | Delete | Programmatically appended button — update the JS that creates it |

### Detail page action pages (Pattern B — add icon prefix)

| Page | Current | Change |
|------|---------|--------|
| `frontend/src/pages/spools/[id]/index.astro` | Edit link + Delete button | Prepend `icon-action-edit` / `icon-action-delete` SVG inside each |
| `frontend/src/pages/filaments/[id]/index.astro` | Edit link + Delete button | Same |
| `frontend/src/pages/printers/[id].astro` | Delete button only | Prepend `icon-action-delete` |

---

## Phase 3 — `fm-btn` with icon helper

To avoid copy-pasting the SVG `<use>` fragment in every template string, add two small helpers to `frontend/src/lib/icons.ts`:

```typescript
/** Returns an inline SVG <use> string for an action icon */
export function actionIcon(id: string, size = 16): string {
  return `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="/icons.svg#icon-action-${id}"/></svg>`
}

/** Returns an fm-btn-icon button HTML string */
export function iconBtn(
  action: string,
  classes: string,
  dataAttrs: string,
  label: string
): string {
  return `<button class="${classes} fm-btn-icon fm-btn-icon--${action}" ${dataAttrs} title="${label}" aria-label="${label}">${actionIcon(action)}</button>`
}
```

Usage in a page:
```typescript
import { iconBtn } from '../../lib/icons'

// In the render function:
`${iconBtn('edit', 'btn-edit', `data-id="${f.id}"`, t('common.edit'))}
 ${iconBtn('delete', 'btn-delete', `data-id="${f.id}"`, t('common.delete'))}`
```

---

## Accessibility notes

- Every icon button has `title` + `aria-label` with the same text
- `aria-hidden="true"` on the inner SVG (the button itself carries the label)
- Keyboard focus ring is inherited from `.fm-btn-icon` (existing `border` + browser default `:focus-visible` outline)
- Buttons remain `<button type="button">` — no role change needed

---

## New files

| File | Role |
|------|------|
| `frontend/src/lib/icons.ts` | `actionIcon()` and `iconBtn()` helpers |

## Modified files

| File | Change |
|------|--------|
| `frontend/public/icons.svg` | 5 new `<symbol>` entries for action icons |
| `frontend/src/styles/global.css` | 3 color modifier classes for `fm-btn-icon` |
| `frontend/src/pages/admin/extra-fields.astro` | Pattern A → icon buttons |
| `frontend/src/pages/admin/devices.astro` | Pattern A → icon buttons |
| `frontend/src/pages/admin/users.astro` | Pattern A → icon buttons |
| `frontend/src/pages/admin/system.astro` | Pattern A → icon buttons |
| `frontend/src/pages/admin/roles.astro` | Pattern C → normalised icon buttons |
| `frontend/src/pages/printers/index.astro` | Pattern A → icon buttons |
| `frontend/src/pages/locations/index.astro` | Pattern A → icon buttons |
| `frontend/src/pages/filaments/colors.astro` | Pattern A → icon buttons |
| `frontend/src/pages/manufacturers/index.astro` | Mixed → icon buttons |
| `frontend/src/pages/settings/api-keys.astro` | JS-built button → icon button |
| `frontend/src/pages/spools/[id]/index.astro` | Pattern B — add icon prefix |
| `frontend/src/pages/filaments/[id]/index.astro` | Pattern B — add icon prefix |
| `frontend/src/pages/printers/[id].astro` | Pattern B — add icon prefix |
