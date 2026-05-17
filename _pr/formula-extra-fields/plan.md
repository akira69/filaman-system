# Formula Field / Extra Fields JSON — Implementation Plan

> Basis: [Spoolman PR #885](https://github.com/Donkie/Spoolman/pull/885)  
> Target repo: akira69/filaman-system  
> Status: Planned

---

## What it adds

A user defines a **Formula Field** in Admin → Extra Fields. The backend evaluates a [JSON Logic](https://jsonlogic.com/) expression at read time against each entity's data and returns computed values under a `derived` namespace in API responses — separate from `custom_fields` (which stores manually entered data). Template tokens like `{derived.weight_per_meter}` work in the label designer.

---

## Phase 1 — Backend model & evaluation

### 1a. Extend `SystemExtraField` model
`backend/app/models/system_extra_field.py` — add 5 new columns:

```python
formula: Mapped[dict | None]       # JSON — NULL = regular field, populated = formula field
show_in_list: Mapped[bool]         # default True
show_in_detail: Mapped[bool]       # default True
show_in_template: Mapped[bool]     # default False
include_in_api: Mapped[bool]       # default False
```

### 1b. Alembic migration
Adds the 5 columns with appropriate defaults so existing rows are unaffected.

### 1c. Add `json-logic-python` dependency
`backend/pyproject.toml`:
```
json-logic-python>=0.9
```

### 1d. New service: `backend/app/services/derived_fields.py`
Responsibilities:
- `build_formula_context(entity)` — constructs the evaluation dict:
  - For a **spool**: all spool scalar fields + `custom_fields.*` + `filament.*` + `filament.custom_fields.*` + `filament.manufacturer.*`
  - For a **filament**: all filament fields + `custom_fields.*` + `manufacturer.*`
- `evaluate_formula(formula: dict, context: dict) → Any` — calls `json_logic.jsonLogic(formula, context)`; returns `None` on error rather than raising
- `compute_derived(entity, formula_fields: list[SystemExtraField]) → dict[str, Any]` — runs all formula fields, returns `{key: value}` for non-null results only

### 1e. Extend response schemas
Add `derived: dict[str, Any] | None = None` to:
- `SpoolResponse` (`schemas_spool.py`)
- `FilamentResponse` (`schemas_filament.py`)

### 1f. Inject `derived` in GET endpoints
After fetching the entity, load formula fields for that target type (cache-friendly — they change rarely), call `compute_derived`, attach to response.

### 1g. Schema validation on create/update
- Validate `formula` is a non-empty dict (structural check)
- Dry-run evaluation with a dummy context to catch obvious expression errors

### 1h. Reference protection on DELETE
Before deleting a regular extra field, scan formula fields for the same `target_type` and block (HTTP 409) if any formula JSON contains the key being deleted. Response includes which formula fields reference it.

---

## Phase 2 — Admin UI (formula authoring)

`frontend/src/pages/admin/extra-fields.astro` — add a **Formula Fields** section below the existing regular fields table.

### Formula Fields table
Columns: Key | Label | Target | Formula (truncated preview) | Surfaces | Actions

### Add/Edit modal
- Key, Label, Target Type (same as regular)
- **JSON Logic editor** — `<textarea>` with monospace font (v1: plain textarea; v2: CodeMirror)
- **Token insertion bar** — grouped buttons:
  - *Operators:* `+`, `-`, `*`, `/`, `>`, `<`, `if`, `cat`, `min`, `max`
  - *Built-in field refs:* `initial_weight_g`, `remaining_weight_g`, `color_hex`, `material`, etc.
  - *Nested refs (spool only):* `filament.weight_g`, `filament.manufacturer.name`, etc.
  - *Extra field refs:* dynamically populated from current `SystemExtraField` list
- **Preview** — sample context JSON input + "Preview" button → calls `POST /api/v1/system-extra-fields/preview` → shows evaluated result or error
- **Display surface toggles:** Show in List / Show in Detail / Include in API / Show in Template

### Referenced In indicator
Each regular extra field row gains a "Referenced In" column showing count of formula fields using its key. Delete is disabled (and shows tooltip) if count > 0.

---

## Phase 3 — Display integration

### Detail pages
`spools/[id]/index.astro`, `filaments/[id]/index.astro`:
- `derived` is already in the API response after Phase 1
- Render formula field values in the custom-fields section with a visual distinction (e.g. `ƒ` badge or italic label)

### List pages
`spools/index.astro`, `filaments/index.astro`:
- Formula fields with `show_in_list=true` appear in the column picker under a **Formula Fields** group
- Values sourced from `derived.*` in row data

### Label designer
`feat/advanced-label-designer` (PR #14):
- `{derived.key}` tokens added to available token list
- Evaluated from the spool's `derived` payload at print time

---

## New files

| File | Role |
|------|------|
| `backend/app/services/derived_fields.py` | Formula evaluation logic |
| `backend/alembic/versions/<hash>_add_formula_fields.py` | Migration |

## Modified files

| File | Change |
|------|--------|
| `backend/app/models/system_extra_field.py` | 5 new columns |
| `backend/app/api/v1/schemas_system_extra_field.py` | `formula`, surface bools in schemas |
| `backend/app/api/v1/system_extra_fields.py` | Preview endpoint + reference protection on delete |
| `backend/app/api/v1/spools.py` | Attach `derived` on GET |
| `backend/app/api/v1/filaments.py` | Attach `derived` on GET |
| `backend/app/api/v1/schemas_spool.py` | `derived` in response |
| `backend/app/api/v1/schemas_filament.py` | `derived` in response |
| `backend/pyproject.toml` | Add `json-logic-python` |
| `frontend/src/pages/admin/extra-fields.astro` | Formula Fields section |
| `frontend/src/pages/spools/[id]/index.astro` | Render `derived` values |
| `frontend/src/pages/filaments/[id]/index.astro` | Render `derived` values |
| `frontend/src/pages/spools/index.astro` | Formula field columns |
| `frontend/src/pages/filaments/index.astro` | Formula field columns |

---

## Deferred (vs Spoolman PR #885)

PR #885 had a grouped/searchable reference picker put back into draft (follow-up in `akira69/Spoolman_Labels#13`). For filaman-system v1, a flat token insertion bar is sufficient — the grouped picker is a Phase 2 follow-up. Everything else maps directly.
