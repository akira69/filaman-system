# Rich Field Types for Extra Fields — Implementation Plan

> Status: Planned  
> Scope: `SystemExtraField` — extends the existing extra fields system without touching built-in model columns

---

## Background & gap analysis

### What filaman currently has

`SystemExtraField.field_type` supports four types, stored in entity `custom_fields` JSON:

| Type | Storage | UI input |
|------|---------|----------|
| `text` | string | `<input type="text">` |
| `number` | number (float) | `<input type="number" step="any">` |
| `dropdown` | string | `<select>` with `options` list |
| `checkbox` | boolean | `<input type="checkbox">` |

### What Spoolman extra fields support

Spoolman's `/fields` API defines types: `text`, `integer`, `float`, `boolean`, `datetime`, `choice`.  
Temperature ranges in Spoolman are *built-in* first-class columns (`settings_extruder_temp`, `settings_bed_temp`) — single values, **not ranges**.

### Gaps and additions

| New type | Storage in `custom_fields` | Primary use cases |
|----------|---------------------------|-------------------|
| `integer` | JSON number (int) | Layer count, copies, pass count |
| `float` | JSON number (decimal) | Alias/successor to `number` with unit support |
| `range_int` | `{"min": 200, "max": 220}` | **Print temp range, bed temp range**, fan % range |
| `range_float` | `{"min": 0.20, "max": 0.40}` | Layer height range, speed ratio range |
| `datetime` | ISO 8601 string | Purchase date, open date, expiry date |
| `url` | string | Product page, shop link, datasheet |
| `multiselect` | JSON array `["a", "b"]` | Compatible printers, tags, certifications |
| `textarea` | string | Extended notes, print profile comments |

**`number` is kept** for backward compatibility — it behaves identically to `float`.

---

## Key structural addition: `config` column

A new `config: JSON | None` column on `SystemExtraField` holds type-specific configuration without breaking the existing `options` list (which stays for `dropdown`/`multiselect`).

Config shapes per type:

```json
// range_int / range_float
{ "unit": "°C", "min_bound": 0, "max_bound": 500, "step": 5 }

// integer / float / number
{ "unit": "g", "min_bound": null, "max_bound": null }

// datetime
{ "date_only": true }

// textarea
{ "max_length": 2000 }

// url, text, checkbox, dropdown, multiselect — config null or {}
```

`options` list continues to hold the option strings for `dropdown` and `multiselect`.

---

## Backward compatibility — existing databases

This section is a hard requirement. Every existing installation must continue to function correctly after the upgrade with zero manual data fixes.

### 1. Database migration is strictly additive

The Alembic migration **only adds** the `config` column. It never drops, renames, or modifies any existing column, index, or constraint. Existing rows keep all their current data; the new `config` column is NULL for every existing row. SQLite and PostgreSQL both support `ADD COLUMN … DEFAULT NULL` as a non-locking operation.

```sql
ALTER TABLE system_extra_fields ADD COLUMN config JSON NULL;
-- No other changes.
```

No `DOWN` migration needed (and none is provided), because dropping a nullable column from an existing install is safe.

### 2. Existing field type values are preserved and read correctly

| Existing `field_type` | What changes | After upgrade |
|-----------------------|-------------|---------------|
| `text` | Nothing | Works identically |
| `number` | Nothing — type string stays `"number"` | Works identically; rendered/edited as float |
| `dropdown` | `options` list untouched; `config` = NULL | Works identically |
| `checkbox` | Nothing | Works identically |

No existing `SystemExtraField` row is modified by the migration.

### 3. `config = NULL` is always safe

Every place in the codebase that reads `config` must treat `NULL` as an empty config — never assume a non-null value. In practice:

- Backend schema: `config: dict | None = None` — already nullable
- Frontend: `const unit = field.config?.unit ?? ''` — optional chaining throughout
- `renderFieldInput` / `renderFieldDisplay`: all config reads use `?? defaultValue` fallbacks

### 4. `custom_fields` entity data requires no migration

Existing spool and filament `custom_fields` JSON is untouched. The new code only adds *new* branches to the `switch (field.field_type)` renderer — existing values for `text`, `number`, `dropdown`, `checkbox` follow the same code paths as before.

### 5. `number` type is never removed or renamed

`number` must remain a valid `field_type` string indefinitely. Any existing DB that has `field_type = 'number'` will:
- Continue to pass schema validation (validator accepts `number` alongside `float`)
- Continue to render an `<input type="number" step="any">` with any optional `unit` from `config`
- Continue to display values in the detail view as before

`float` is purely an alias for new fields — it adds `config.unit` support that `number` also inherits. They share the same render path.

### 6. Field type is immutable after first use

If a field definition already has entity data stored against it, changing `field_type` would silently corrupt display (e.g., a stored `"PLA"` string rendered by a `range_int` renderer that expects `{"min":…,"max":…}`). To prevent this:

- **Admin UI**: when editing an existing field, the `field_type` selector is disabled and shows a tooltip: *"Field type cannot be changed after the field has been created."*
- **Backend PUT endpoint**: include a check — if `field_type` differs from the current value, return HTTP 409 with `"Field type is immutable after creation."` This is a new guard added alongside the other validations; it does not affect existing PUT calls that omit `field_type`.

> Note: plugin-managed fields already cannot be edited at all (403), so this only applies to user-created fields.

### 7. API response schema is additive

`SystemExtraFieldResponse` gains `config: dict | None = None`. Existing API consumers that don't read `config` are unaffected. The field is omitted from serialization when `None` if `model_config = ConfigDict(exclude_none=True)` is set; otherwise it serializes as `null`. Either behaviour is backward-compatible.

### 8. Plugin-managed fields

Plugins that register fields via `SystemExtraFieldCreate` with `source` set do not pass `config`. That is fine — `config` defaults to `None` and the field behaves as it did before. Plugin authors can opt into `config` when they are ready.

---

## Phase 1 — Backend

### 1a. Extend `SystemExtraField` model
`backend/app/models/system_extra_field.py`:

```python
config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
# type comment update: text, number, integer, float, range_int, range_float,
#                      dropdown, checkbox, datetime, url, multiselect, textarea
```

### 1b. Alembic migration
Adds `config JSON NULL` column. Existing rows stay unchanged (NULL config).

### 1c. Update schemas
`backend/app/api/v1/schemas_system_extra_field.py`:
- Add `config: dict | None = None` to `SystemExtraFieldBase`, `SystemExtraFieldUpdate`, `SystemExtraFieldResponse`
- Add a `@model_validator` that enforces per-type constraints:
  - `range_int` / `range_float`: `config` must be present; if `min_bound` and `max_bound` both set, min < max
  - `dropdown` / `multiselect`: `options` must be a non-empty list
  - `url`: optional, no extra config required
  - etc.
- Add immutability guard to PUT endpoint (see backward compatibility §6)

### 1d. No entity model changes
All values serialize into the existing `custom_fields: JSON` column. A `range` value is stored as `{"min": ..., "max": ...}`, an array value as `[...]`, etc.

---

## Phase 2 — Admin UI

`frontend/src/pages/admin/extra-fields.astro`:

### Type selector additions
```html
<option value="integer">Integer</option>
<option value="float">Float (decimal)</option>
<option value="range_int">Range — Integer (e.g. 200–220 °C)</option>
<option value="range_float">Range — Float (e.g. 0.20–0.40 mm)</option>
<option value="datetime">Date / Datetime</option>
<option value="url">URL</option>
<option value="multiselect">Multi-select</option>
<option value="textarea">Textarea (long text)</option>
```

### Conditional config panels (appear below type selector)

**Range types** — show:
- Unit input (`°C`, `mm/s`, `%`, etc.)
- Min bound (optional)
- Max bound (optional)
- Step (optional)

**Integer / Float** — show:
- Unit input (optional)
- Min / Max bounds (optional)

**Datetime** — show:
- Toggle: "Date only" vs "Date + time"

**Textarea** — show:
- Max length (optional, default 2000)

**Dropdown / Multiselect** — existing `options` textarea (already shown)

**URL, Text, Checkbox** — no extra config

### Type selector — immutability on edit
When `openEditModal(field)` is called for an existing field, set `field-type.disabled = true` and add a `<small>` hint: *"Field type cannot be changed."*

### `fieldTypeLabel()` update
Add labels for all new types. Existing type strings (`text`, `number`, `dropdown`, `checkbox`) keep their current labels.

---

## Phase 3 — Entity forms (create / edit)

All pages that render system field inputs use `switch (field.field_type)`. Add cases:

### New `frontend/src/lib/extra-fields.ts`
Export two shared helpers to avoid duplicating the 12+ case switch across 6 pages:

```typescript
// Returns an HTML string for the input control
export function renderFieldInput(field: SystemExtraField, currentValue: unknown): string

// Returns an HTML string for displaying a stored value (read-only)
export function renderFieldDisplay(field: SystemExtraField, value: unknown): string
```

**Type-mismatch fallback rule**: if the stored value in `custom_fields` does not match the shape expected by `field_type` (e.g., a plain string stored against a `range_int` field), both helpers fall back to rendering the raw value as plain text — they never throw. This handles the (rare but possible) case where a DB was migrated from an older plugin schema or the field was defined before data existed.

Rendering per type:

| Type | Input | Display |
|------|-------|---------|
| `integer` | `<input type="number" step="1">` | `42 layers` |
| `float` / `number` | `<input type="number" step="any">` | `1.24 g/cm³` |
| `range_int` | Two `<input type="number" step="1">` min+max side-by-side | `200–220 °C` |
| `range_float` | Two `<input type="number" step="any">` min+max | `0.20–0.40 mm` |
| `datetime` | `<input type="date">` or `<input type="datetime-local">` | Localized date string |
| `url` | `<input type="url">` | `<a href="..." target="_blank" rel="noopener">` |
| `multiselect` | Checkbox list from `options` | Comma-separated pills |
| `textarea` | `<textarea rows="3">` | `<pre>` with scroll cap |

### Storage conventions for new types in `custom_fields`:

```jsonc
// range_int key "print_temp"
{ "print_temp": { "min": 200, "max": 220 } }

// multiselect key "compatible_printers"
{ "compatible_printers": ["Bambu X1C", "Prusa MK4"] }

// datetime key "opened_at"
{ "opened_at": "2025-11-01" }
```

### Pages to update (add helper import + replace inline switch):
- `frontend/src/pages/filaments/new.astro`
- `frontend/src/pages/filaments/[id]/edit.astro`
- `frontend/src/pages/spools/new.astro` (if exists)
- `frontend/src/pages/spools/[id]/edit.astro`

---

## Phase 4 — Display integration

### Detail pages
- `frontend/src/pages/filaments/[id]/index.astro`
- `frontend/src/pages/spools/[id]/index.astro`

Use `renderFieldDisplay()` from the shared helper in place of the existing `.map(([key, value]) => ...)` fallback.

### List pages (column rendering)
- `frontend/src/pages/spools/index.astro`
- `frontend/src/pages/filaments/index.astro`

Column cells for range/multiselect types need compact representations:
- `range_int`: `200–220°C`
- `multiselect`: first 2 values + `+N more` badge
- `url`: icon link only

---

## New files

| File | Role |
|------|------|
| `frontend/src/lib/extra-fields.ts` | Shared field input/display renderer |
| `backend/alembic/versions/<hash>_add_extra_field_config.py` | Migration |

## Modified files

| File | Change |
|------|--------|
| `backend/app/models/system_extra_field.py` | Add `config: JSON` column |
| `backend/app/api/v1/schemas_system_extra_field.py` | Add `config`; per-type validator; immutability guard |
| `backend/app/api/v1/system_extra_fields.py` | PUT: enforce field_type immutability |
| `frontend/src/pages/admin/extra-fields.astro` | 8 new type options + config panels + disabled type on edit |
| `frontend/src/pages/filaments/new.astro` | New input types via shared helper |
| `frontend/src/pages/filaments/[id]/edit.astro` | New input types |
| `frontend/src/pages/filaments/[id]/index.astro` | New display types |
| `frontend/src/pages/spools/[id]/edit.astro` | New input types |
| `frontend/src/pages/spools/[id]/index.astro` | New display types |
| `frontend/src/pages/spools/index.astro` | Compact column rendering |
| `frontend/src/pages/filaments/index.astro` | Compact column rendering |

---

## Comparison with Spoolman

| Type | Spoolman extra fields | filaman after this plan |
|------|-----------------------|------------------------|
| Text | `text` ✓ | `text` ✓ |
| Integer | `integer` | `integer` ← NEW |
| Float | `float` | `float` / `number` ✓ |
| Boolean | `boolean` | `checkbox` ✓ |
| Date/time | `datetime` | `datetime` ← NEW |
| Single select | `choice` | `dropdown` ✓ |
| Range | ✗ (built-in only) | `range_int` / `range_float` ← NEW |
| Multi-select | ✗ | `multiselect` ← NEW |
| URL | ✗ | `url` ← NEW |
| Long text | ✗ | `textarea` ← NEW |

filaman matches Spoolman's type coverage and adds range, multiselect, url, and textarea on top.
