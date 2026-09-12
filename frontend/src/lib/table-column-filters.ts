import { t } from './i18n'
import { normalizeHexCode, toOpaqueRgbHex } from './colors'
import type { SystemExtraFieldDef } from './extra-fields'

export type HeaderFilterOption = {
  value: string
  label: string
  colorHexes?: string[]
}

export type TextFilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'notContains' | 'isEmpty' | 'isNotEmpty'
export type NumberFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'isEmpty' | 'isNotEmpty'
export type DateFilterOperator = 'on' | 'before' | 'after' | 'between' | 'isEmpty' | 'isNotEmpty'
export type ColorNeutral = 'black' | 'white' | 'grey'
export type ColorFilterMode = 'none' | 'color' | ColorNeutral
export type ColorFilterValue = {
  type: 'color'
  mode: ColorFilterMode
  hueFrom: number
  hueTo: number
  saturationFrom: number
  saturationTo: number
  valueFrom: number
  valueTo: number
  valuePreview: number
  includeTransparent: boolean
}

type LegacyColorFilterValue = Omit<ColorFilterValue, 'mode'> & {
  chromatic?: boolean
  neutrals?: unknown
}

export type ColumnFilterValue =
  | { type: 'multi'; values: string[] }
  | { type: 'text'; operator: TextFilterOperator; value: string }
  | { type: 'number'; operator: NumberFilterOperator; value: string; valueTo: string }
  | { type: 'date'; operator: DateFilterOperator; value: string; valueTo: string }
  | ColorFilterValue

export type HeaderFilterDefinition = {
  key: string
  label: string
  columnSelector: string
  type: ColumnFilterValue['type']
  multiDisplay?: 'default' | 'colors'
  icon?: 'filter' | 'gear'
  options?: HeaderFilterOption[]
  initialValue?: ColumnFilterValue
  onApply: (value: ColumnFilterValue) => void
}

export type HeaderFilterController = {
  setOptions: (key: string, options: HeaderFilterOption[]) => void
  setValue: (key: string, value: ColumnFilterValue) => void
  getValue: (key: string) => ColumnFilterValue | null
  getActiveCount: () => number
  resetAll: () => void
}

export type SortDirection = 'asc' | 'desc' | null

export type TableFilterControlOptions = {
  onApply: () => void
  onClearColumns: () => void
  onClearAll: () => void
  debounceMs?: number
}

type FilterState = {
  def: HeaderFilterDefinition
  options: HeaderFilterOption[]
  applied: ColumnFilterValue
  working: ColumnFilterValue
  optionSearch: string
  optionView: 'details' | 'swatches'
  trigger: HTMLButtonElement
  panel: HTMLDivElement
  list: HTMLDivElement | null
  optionSearchInput: HTMLInputElement | null
  operatorSelect: HTMLSelectElement | null
  valueInput: HTMLInputElement | null
  valueToInput: HTMLInputElement | null
}

const FILTER_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
  </svg>
`

const GEAR_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
`

const SORT_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <g class="fm-header-sort-icon-neutral">
      <path d="M8 18V6m0 0-4 4m4-4 4 4" />
      <path d="M16 6v12m0 0-4-4m4 4 4-4" />
    </g>
    <g class="fm-header-sort-icon-asc">
      <path d="M12 19V5m0 0-5 5m5-5 5 5" />
    </g>
    <g class="fm-header-sort-icon-desc">
      <path d="M12 5v14m0 0-5-5m5 5 5-5" />
    </g>
  </svg>
`

const TEXT_OPERATORS: { value: TextFilterOperator; labelKey: string }[] = [
  { value: 'contains', labelKey: 'filters.contains' },
  { value: 'equals', labelKey: 'filters.equals' },
  { value: 'startsWith', labelKey: 'filters.startsWith' },
  { value: 'endsWith', labelKey: 'filters.endsWith' },
  { value: 'notContains', labelKey: 'filters.notContains' },
  { value: 'isEmpty', labelKey: 'filters.isEmpty' },
  { value: 'isNotEmpty', labelKey: 'filters.isNotEmpty' },
]

const NUMBER_OPERATORS: { value: NumberFilterOperator; labelKey: string }[] = [
  { value: 'eq', labelKey: 'filters.equals' },
  { value: 'neq', labelKey: 'filters.notEquals' },
  { value: 'gt', labelKey: 'filters.greaterThan' },
  { value: 'gte', labelKey: 'filters.atLeast' },
  { value: 'lt', labelKey: 'filters.lessThan' },
  { value: 'lte', labelKey: 'filters.atMost' },
  { value: 'between', labelKey: 'filters.between' },
  { value: 'isEmpty', labelKey: 'filters.isEmpty' },
  { value: 'isNotEmpty', labelKey: 'filters.isNotEmpty' },
]

const DATE_OPERATORS: { value: DateFilterOperator; labelKey: string }[] = [
  { value: 'on', labelKey: 'filters.on' },
  { value: 'before', labelKey: 'filters.before' },
  { value: 'after', labelKey: 'filters.after' },
  { value: 'between', labelKey: 'filters.between' },
  { value: 'isEmpty', labelKey: 'filters.isEmpty' },
  { value: 'isNotEmpty', labelKey: 'filters.isNotEmpty' },
]

let nextPanelId = 0

export function emptyColumnFilter(type: ColumnFilterValue['type']): ColumnFilterValue {
  if (type === 'multi') return { type, values: [] }
  if (type === 'text') return { type, operator: 'contains', value: '' }
  if (type === 'number') return { type, operator: 'eq', value: '', valueTo: '' }
  if (type === 'color') return { type, mode: 'none', hueFrom: 10, hueTo: 45, saturationFrom: 20, saturationTo: 100, valueFrom: 0, valueTo: 100, valuePreview: 100, includeTransparent: false }
  return { type, operator: 'on', value: '', valueTo: '' }
}

export function multiColumnFilter(values: string[]): ColumnFilterValue {
  return { type: 'multi', values: [...values] }
}

export function systemExtraFieldFilterType(
  fieldType: string | null | undefined,
): ColumnFilterValue['type'] {
  if (fieldType === 'number' || fieldType === 'float') return 'number'
  if (fieldType === 'date') return 'date'
  if (fieldType === 'dropdown' || fieldType === 'multiselect' || fieldType === 'checkbox') return 'multi'
  return 'text'
}

export function systemExtraFieldFilterValue(
  field: SystemExtraFieldDef,
  rawValue: unknown,
): unknown {
  if (field.field_type === 'checkbox') {
    return rawValue === true || rawValue === 'true' ? 'true' : 'false'
  }
  if (field.field_type === 'range' && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const range = rawValue as Record<string, unknown>
    return [range.min, range.max]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map(String)
      .join(' – ')
  }
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return JSON.stringify(rawValue)
  }
  return rawValue
}

export function systemExtraFieldHeaderFilter(
  field: SystemExtraFieldDef,
  initialValue: ColumnFilterValue | undefined,
  onApply: (value: ColumnFilterValue) => void,
): HeaderFilterDefinition {
  const key = `cf_${field.key}`
  const type = systemExtraFieldFilterType(field.field_type)
  let options: HeaderFilterOption[] | undefined
  if (field.field_type === 'checkbox') {
    options = [
      { value: 'true', label: t('common.yes') },
      { value: 'false', label: t('common.no') },
    ]
  } else if (type === 'multi') {
    options = [
      { value: '', label: t('common.empty') },
      ...(field.options ?? []).map((option) => ({ value: option, label: option })),
    ]
  }
  return {
    key,
    label: field.label,
    columnSelector: `th.col-${key}`,
    type,
    options,
    initialValue,
    onApply,
  }
}

export function isColumnFilterActive(value: ColumnFilterValue | null | undefined): boolean {
  if (!value) return false
  if (value.type === 'multi') return value.values.length > 0
  if (value.type === 'color') return value.mode !== 'none' || value.includeTransparent
  if (value.operator === 'isEmpty' || value.operator === 'isNotEmpty') return true
  if (value.operator === 'between') return value.value !== '' && value.valueTo !== ''
  return value.value !== ''
}

export function bindTableFilterControls({
  onApply,
  onClearColumns,
  onClearAll,
  debounceMs = 250,
}: TableFilterControlOptions): void {
  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  const cancelSearchDebounce = () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = null
  }

  document.getElementById('filter-search')?.addEventListener('input', () => {
    cancelSearchDebounce()
    searchTimeout = setTimeout(onApply, debounceMs)
  })
  document.getElementById('filter-search-clear')?.addEventListener('click', () => {
    cancelSearchDebounce()
    const search = document.getElementById('filter-search') as HTMLInputElement | null
    if (search) search.value = ''
    onApply()
  })
  document.getElementById('filter-group')?.addEventListener('change', onApply)
  document.getElementById('filter-clear-columns')?.addEventListener('click', onClearColumns)
  document.getElementById('filter-clear')?.addEventListener('click', () => {
    cancelSearchDebounce()
    const search = document.getElementById('filter-search') as HTMLInputElement | null
    if (search) search.value = ''
    const group = document.getElementById('filter-group') as HTMLInputElement | null
    if (group) group.checked = false
    onClearAll()
  })
}

export function matchesColumnFilter(rawValue: unknown, filter: ColumnFilterValue | null | undefined): boolean {
  if (!isColumnFilterActive(filter) || !filter) return true

  if (filter.type === 'color') return matchesColorFilter(rawValue, filter)

  const isEmpty = rawValue == null || rawValue === '' || (Array.isArray(rawValue) && rawValue.length === 0)
  if (filter.type !== 'multi' && filter.operator === 'isEmpty') return isEmpty
  if (filter.type !== 'multi' && filter.operator === 'isNotEmpty') return !isEmpty

  if (filter.type === 'multi') {
    const values = isEmpty ? [''] : Array.isArray(rawValue) ? rawValue : [rawValue]
    const normalized = values.map((value) => value == null ? '' : String(value))
    return filter.values.some((value) => normalized.includes(value))
  }

  if (isEmpty) return false

  if (filter.type === 'text') {
    const actual = String(rawValue ?? '').toLowerCase()
    const expected = filter.value.toLowerCase()
    if (filter.operator === 'equals') return actual === expected
    if (filter.operator === 'startsWith') return actual.startsWith(expected)
    if (filter.operator === 'endsWith') return actual.endsWith(expected)
    if (filter.operator === 'notContains') return !actual.includes(expected)
    return actual.includes(expected)
  }

  if (filter.type === 'number') {
    const actual = Number(rawValue)
    const expected = Number(filter.value)
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false
    if (filter.operator === 'neq') return actual !== expected
    if (filter.operator === 'gt') return actual > expected
    if (filter.operator === 'gte') return actual >= expected
    if (filter.operator === 'lt') return actual < expected
    if (filter.operator === 'lte') return actual <= expected
    if (filter.operator === 'between') {
      const upper = Number(filter.valueTo)
      return Number.isFinite(upper) && actual >= Math.min(expected, upper) && actual <= Math.max(expected, upper)
    }
    return actual === expected
  }

  const actual = normalizeDate(rawValue)
  const expected = normalizeDate(filter.value)
  if (!actual || !expected) return false
  if (filter.operator === 'before') return actual < expected
  if (filter.operator === 'after') return actual > expected
  if (filter.operator === 'between') {
    const upper = normalizeDate(filter.valueTo)
    return !!upper && actual >= (expected < upper ? expected : upper) && actual <= (expected > upper ? expected : upper)
  }
  return actual === expected
}

export function matchesColorFilter(rawValue: unknown, filter: ColorFilterValue): boolean {
  const values = Array.isArray(rawValue) ? rawValue : [rawValue]
  return values.some((value) => {
    const normalized = typeof value === 'string' ? normalizeHexCode(value) : ''
    if (!normalized) return false
    const hex = toOpaqueRgbHex(normalized)
    const { hue, saturation, value: brightness } = hexToHsv(hex)
    const hueMatches = filter.hueFrom <= filter.hueTo
      ? hue >= filter.hueFrom && hue <= filter.hueTo
      : hue >= filter.hueFrom || hue <= filter.hueTo
    const chromatic = filter.mode === 'color'
      && hueMatches
      && saturation >= Math.min(filter.saturationFrom, filter.saturationTo)
      && saturation <= Math.max(filter.saturationFrom, filter.saturationTo)
      && brightness >= Math.min(filter.valueFrom, filter.valueTo)
      && brightness <= Math.max(filter.valueFrom, filter.valueTo)
    const neutral = filter.mode === 'black'
      ? brightness <= 15 && saturation <= 20
      : filter.mode === 'white'
        ? brightness >= 85 && saturation <= 10
        : filter.mode === 'grey'
          ? brightness >= 35 && brightness <= 65 && saturation <= 10
          : false
    const transparent = filter.includeTransparent
      && normalized.length === 9
      && normalized.slice(-2) !== 'FF'
    return chromatic || neutral || transparent
  })
}

export function normalizeColorFilter(value: ColorFilterValue | LegacyColorFilterValue): ColorFilterValue {
  const legacy = value as LegacyColorFilterValue
  const neutral = Array.isArray(legacy.neutrals)
    ? legacy.neutrals.find(
      (item): item is ColorNeutral => item === 'black' || item === 'white' || item === 'grey',
    )
    : undefined
  const suppliedMode = (value as ColorFilterValue).mode
  const mode: ColorFilterMode = neutral
    ?? (suppliedMode === 'none' || suppliedMode === 'color' || suppliedMode === 'black' || suppliedMode === 'white' || suppliedMode === 'grey'
      ? suppliedMode
      : legacy.chromatic ? 'color' : 'none')
  const valueLow = Math.min(value.valueFrom, value.valueTo)
  const valueHigh = Math.max(value.valueFrom, value.valueTo)
  const preview = Number.isFinite(value.valuePreview) ? value.valuePreview : valueHigh
  const valuePreview = Math.max(valueLow, Math.min(valueHigh, preview))
  return {
    type: 'color', mode,
    hueFrom: value.hueFrom, hueTo: value.hueTo,
    saturationFrom: value.saturationFrom, saturationTo: value.saturationTo,
    valueFrom: value.valueFrom, valueTo: value.valueTo, valuePreview,
    includeTransparent: value.includeTransparent,
  }
}

function hexToHsv(hex: string): { hue: number; saturation: number; value: number } {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue = (hue * 60 + 360) % 360
  }
  return {
    hue,
    saturation: max === 0 ? 0 : delta / max * 100,
    value: max * 100,
  }
}

export function colorWheelPixels(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4)
  const radius = size / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - radius
      const dy = y + 0.5 - radius
      const saturation = Math.hypot(dx, dy) / radius
      if (saturation > 1) continue

      const sector = ((360 - Math.atan2(dy, dx) * 180 / Math.PI) % 360) / 60
      const chroma = saturation
      const secondary = chroma * (1 - Math.abs(sector % 2 - 1))
      const match = 1 - chroma
      const [red, green, blue] = sector < 1 ? [chroma, secondary, 0]
        : sector < 2 ? [secondary, chroma, 0]
          : sector < 3 ? [0, chroma, secondary]
            : sector < 4 ? [0, secondary, chroma]
              : sector < 5 ? [secondary, 0, chroma]
                : [chroma, 0, secondary]
      const offset = (y * size + x) * 4
      pixels.set([
        Math.round((red + match) * 255),
        Math.round((green + match) * 255),
        Math.round((blue + match) * 255),
        255,
      ], offset)
    }
  }

  return pixels
}

function paintColorWheel(canvas: HTMLCanvasElement) {
  const size = Math.round(180 * (window.devicePixelRatio || 1))
  const context = canvas.getContext('2d')
  if (!context) return
  canvas.width = size
  canvas.height = size
  const image = context.createImageData(size, size)
  image.data.set(colorWheelPixels(size))
  context.putImageData(image, 0, 0)
}

function normalizeDate(value: unknown): string {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return ''
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, '0'),
    String(parsed.getDate()).padStart(2, '0'),
  ].join('-')
}

function cloneFilter(value: ColumnFilterValue): ColumnFilterValue {
  if (value.type === 'multi') return { type: 'multi', values: [...value.values] }
  if (value.type === 'color') return normalizeColorFilter(value)
  if (value.type === 'text') return { ...value }
  return { ...value }
}

function sameFilter(a: ColumnFilterValue, b: ColumnFilterValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function initHeaderColumnFilters(
  table: HTMLTableElement,
  defs: HeaderFilterDefinition[],
): HeaderFilterController {
  const firstHeader = table.querySelector('thead tr')
  if (!firstHeader) throw new Error('initHeaderColumnFilters: missing table header row')

  const states = new Map<string, FilterState>()
  const openPanels = new Set<HTMLDivElement>()

  installHeaderSortButtons(firstHeader)

  function closePanel(panel: HTMLDivElement) {
    panel.classList.remove('open')
    const state = [...states.values()].find((candidate) => candidate.panel === panel)
    state?.trigger.setAttribute('aria-expanded', 'false')
    openPanels.delete(panel)
  }

  function positionPanel(state: FilterState) {
    const rect = state.trigger.getBoundingClientRect()
    const panelWidth = state.panel.offsetWidth
    const panelHeight = state.panel.offsetHeight
    const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8))
    const preferredTop = rect.bottom + 6
    const top = preferredTop + panelHeight <= window.innerHeight - 8
      ? preferredTop
      : Math.max(8, rect.top - panelHeight - 6)
    state.panel.style.left = `${left}px`
    state.panel.style.top = `${top}px`
  }

  function repositionOpenPanels() {
    openPanels.forEach((panel) => {
      const state = [...states.values()].find((candidate) => candidate.panel === panel)
      if (state) positionPanel(state)
    })
  }

  defs.forEach((def) => {
    const cell = firstHeader.querySelector(def.columnSelector) as HTMLTableCellElement | null
    if (!cell) return

    preserveTranslatedHeading(cell, def.label)

    const wrap = ensureHeaderControls(cell)

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'fm-header-filter-trigger'
    trigger.setAttribute('aria-label', t('filters.filterColumn', { label: def.label }))
    trigger.setAttribute('aria-expanded', 'false')
    trigger.setAttribute('aria-haspopup', 'dialog')
    trigger.title = t('filters.filterColumn', { label: def.label })
    trigger.innerHTML = def.icon === 'gear' ? GEAR_ICON : FILTER_ICON

    const panel = document.createElement('div')
    panel.className = 'fm-header-filter-panel'
    panel.id = `fm-header-filter-panel-${nextPanelId++}`
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('filters.filterColumn', { label: def.label }))
    trigger.setAttribute('aria-controls', panel.id)

    const initial = def.initialValue?.type === def.type
      ? cloneFilter(def.initialValue)
      : emptyColumnFilter(def.type)

    const state: FilterState = {
      def,
      options: [...(def.options || [])],
      applied: cloneFilter(initial),
      working: cloneFilter(initial),
      optionSearch: '',
      optionView: 'details',
      trigger,
      panel,
      list: null,
      optionSearchInput: null,
      operatorSelect: null,
      valueInput: null,
      valueToInput: null,
    }

    if (def.type === 'multi') buildMultiControls(state)
    else if (def.type === 'color') buildColorControls(state)
    else buildTypedControls(state)

    const actions = document.createElement('div')
    actions.className = 'fm-header-filter-actions'

    const applyBtn = document.createElement('button')
    applyBtn.type = 'button'
    applyBtn.className = 'fm-btn fm-btn-primary fm-header-filter-action'
    applyBtn.textContent = t('filters.apply')

    const clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.className = 'fm-btn fm-btn-outline fm-header-filter-action'
    clearBtn.textContent = t('filters.clear')

    actions.appendChild(applyBtn)
    actions.appendChild(clearBtn)
    if (def.multiDisplay === 'colors') appendColorGridToggle(actions, state)
    panel.appendChild(actions)

    wrap.appendChild(trigger)
    document.body.appendChild(panel)
    states.set(def.key, state)

    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      if (panel.classList.contains('open')) {
        closePanel(panel)
        return
      }
      openPanels.forEach(closePanel)
      state.working = cloneFilter(state.applied)
      syncControls(state)
      panel.classList.add('open')
      trigger.setAttribute('aria-expanded', 'true')
      openPanels.add(panel)
      positionPanel(state)
      const focusTarget = state.optionSearchInput
        || state.valueInput
        || state.operatorSelect
        || panel.querySelector<HTMLElement>('[aria-pressed="true"]')
        || panel.querySelector<HTMLElement>('input:not(:disabled), button')
      focusTarget?.focus()
    })

    panel.addEventListener('click', (event) => event.stopPropagation())
    panel.addEventListener('dragstart', (event) => event.preventDefault())
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closePanel(panel)
      trigger.focus()
    })

    applyBtn.addEventListener('click', () => {
      state.applied = cloneFilter(state.working)
      state.def.onApply(cloneFilter(state.applied))
      closePanel(panel)
      updateTrigger(state)
    })

    clearBtn.addEventListener('click', () => {
      state.applied = emptyColumnFilter(def.type)
      state.working = emptyColumnFilter(def.type)
      state.optionSearch = ''
      state.def.onApply(cloneFilter(state.applied))
      syncControls(state)
      updateTrigger(state)
    })

    syncControls(state)
    updateTrigger(state)
  })

  document.addEventListener('click', () => openPanels.forEach(closePanel))
  window.addEventListener('resize', repositionOpenPanels)
  window.addEventListener('scroll', repositionOpenPanels, true)

  return {
    setOptions: (key, options) => {
      const state = states.get(key)
      if (!state || state.def.type !== 'multi') return
      state.options = [...options]
      syncControls(state)
      updateTrigger(state)
    },
    setValue: (key, value) => {
      const state = states.get(key)
      if (!state || value.type !== state.def.type) return
      state.applied = cloneFilter(value)
      state.working = cloneFilter(value)
      syncControls(state)
      updateTrigger(state)
    },
    getValue: (key) => {
      const state = states.get(key)
      return state ? cloneFilter(state.applied) : null
    },
    getActiveCount: () => [...states.values()].filter((state) => isColumnFilterActive(state.applied)).length,
    resetAll: () => {
      states.forEach((state) => {
        state.applied = emptyColumnFilter(state.def.type)
        state.working = emptyColumnFilter(state.def.type)
        state.optionSearch = ''
        syncControls(state)
        updateTrigger(state)
      })
      openPanels.forEach(closePanel)
    },
  }
}

function ensureHeaderControls(cell: HTMLTableCellElement): HTMLDivElement {
  const existing = cell.querySelector(':scope > .fm-header-filter-wrap') as HTMLDivElement | null
  if (existing) return existing
  const wrap = document.createElement('div')
  wrap.className = 'fm-header-filter-wrap'
  cell.appendChild(wrap)
  return wrap
}

function installHeaderSortButtons(headerRow: Element) {
  headerRow.querySelectorAll<HTMLTableCellElement>('th[data-sort]').forEach((cell) => {
    const wrap = ensureHeaderControls(cell)
    if (wrap.querySelector('.fm-header-sort-trigger')) return
    const label = cell.textContent?.trim() || cell.dataset.sort || ''
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'fm-header-sort-trigger'
    button.dataset.sortLabel = label
    button.setAttribute('aria-label', t('filters.sortColumn', { label }))
    button.title = t('filters.sortColumn', { label })
    button.innerHTML = SORT_ICON
    wrap.appendChild(button)
  })
}

export function syncHeaderSortButtons(
  table: HTMLTableElement,
  activeKey: string | null,
  direction: SortDirection,
) {
  table.querySelectorAll<HTMLTableCellElement>('th[data-sort]').forEach((cell) => {
    const button = cell.querySelector('.fm-header-sort-trigger') as HTMLButtonElement | null
    if (!button) return
    const label = button.dataset.sortLabel || cell.dataset.sort || ''
    const isActive = cell.dataset.sort === activeKey && direction !== null
    const state = isActive
      ? direction === 'asc' ? t('filters.ascending') : t('filters.descending')
      : t('filters.notSorted')
    button.setAttribute('aria-label', t('filters.sortColumnState', { label, state }))
    button.title = t('filters.sortColumnState', { label, state })
    button.setAttribute('aria-pressed', String(isActive))
  })
}

function preserveTranslatedHeading(cell: HTMLTableCellElement, label: string) {
  const i18nKey = cell.getAttribute('data-i18n')
  if (!i18nKey) return
  const heading = document.createElement('span')
  heading.className = 'fm-header-filter-heading'
  heading.setAttribute('data-i18n', i18nKey)
  heading.textContent = label
  Array.from(cell.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .forEach((node) => node.remove())
  cell.removeAttribute('data-i18n')
  cell.insertBefore(heading, cell.firstChild)
}

function buildMultiControls(state: FilterState) {
  const search = document.createElement('input')
  search.className = 'fm-input fm-header-filter-search'
  search.type = 'text'
  search.placeholder = t('filters.searchOptions', { label: state.def.label })
  search.setAttribute('aria-label', t('filters.searchOptions', { label: state.def.label }))

  const selectionActions = document.createElement('div')
  selectionActions.className = 'fm-header-filter-selection-actions'

  const selectAll = document.createElement('button')
  selectAll.type = 'button'
  selectAll.className = 'fm-btn fm-btn-outline fm-header-filter-action'
  selectAll.textContent = t('filters.selectAll')

  const selectNone = document.createElement('button')
  selectNone.type = 'button'
  selectNone.className = 'fm-btn fm-btn-outline fm-header-filter-action'
  selectNone.textContent = t('filters.selectNone')

  selectionActions.appendChild(selectAll)
  selectionActions.appendChild(selectNone)

  const list = document.createElement('div')
  list.className = 'fm-header-filter-list'

  search.addEventListener('input', () => {
    state.optionSearch = search.value
    renderMultiList(state)
  })
  selectAll.addEventListener('click', () => updateVisibleMultiOptions(state, true))
  selectNone.addEventListener('click', () => updateVisibleMultiOptions(state, false))

  state.optionSearchInput = search
  state.list = list
  state.panel.appendChild(search)
  state.panel.appendChild(selectionActions)
  state.panel.appendChild(list)
}

function appendColorGridToggle(actions: HTMLDivElement, state: FilterState) {
  const label = document.createElement('label')
  label.className = 'fm-header-filter-grid-toggle'

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = state.optionView === 'swatches'
  input.setAttribute('role', 'switch')
  input.setAttribute('aria-label', t('filters.colorGrid'))

  const track = document.createElement('span')
  track.className = 'fm-header-filter-grid-toggle-track'
  track.setAttribute('aria-hidden', 'true')

  const text = document.createElement('span')
  text.textContent = t('filters.colorGrid')

  input.addEventListener('change', () => {
    state.optionView = input.checked ? 'swatches' : 'details'
    renderMultiList(state)
  })

  label.appendChild(input)
  label.appendChild(track)
  label.appendChild(text)
  actions.appendChild(label)
}

function buildColorControls(state: FilterState) {
  const controls = document.createElement('div')
  controls.className = 'fm-header-color-controls'

  const title = document.createElement('h3')
  title.className = 'fm-header-color-title'
  title.textContent = t('filters.colorFilter')
  controls.appendChild(title)

  const modes = document.createElement('div')
  modes.className = 'fm-header-color-modes'
  const colorButton = document.createElement('button')
  colorButton.type = 'button'
  colorButton.dataset.colorMode = 'color'
  colorButton.setAttribute('aria-pressed', 'true')
  const colorIcon = document.createElement('span')
  colorIcon.className = 'fm-header-color-wheel-icon'
  colorIcon.setAttribute('aria-hidden', 'true')
  colorButton.appendChild(colorIcon)
  colorButton.append(t('filaments.color'))
  colorButton.addEventListener('click', () => {
    if (state.working.type !== 'color') return
    state.working.mode = 'color'
    syncColorControls(state)
    updateTrigger(state)
  })
  modes.appendChild(colorButton)

  ;(['black', 'white', 'grey'] as const).forEach((neutral) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.colorNeutral = neutral
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      if (state.working.type !== 'color') return
      const selected = state.working.mode === neutral
      state.working.mode = selected ? 'color' : neutral
      syncColorControls(state)
      updateTrigger(state)
    })
    const swatch = document.createElement('span')
    swatch.className = `fm-header-color-neutral-swatch ${neutral}`
    swatch.setAttribute('aria-hidden', 'true')
    button.appendChild(swatch)
    button.append(t(`filters.soft${neutral.charAt(0).toUpperCase()}${neutral.slice(1)}`))
    modes.appendChild(button)
  })
  controls.appendChild(modes)

  const wheel = document.createElement('div')
  wheel.className = 'fm-header-color-wheel'
  wheel.tabIndex = 0
  wheel.setAttribute('role', 'slider')
  wheel.setAttribute('aria-label', t('filters.moveHueArc'))
  wheel.setAttribute('aria-valuemin', '0')
  wheel.setAttribute('aria-valuemax', '359')
  const surface = document.createElement('canvas')
  surface.className = 'fm-header-color-wheel-surface'
  surface.setAttribute('aria-hidden', 'true')
  paintColorWheel(surface)
  const selection = document.createElement('span')
  selection.className = 'fm-header-color-wheel-selection'
  wheel.append(surface, selection)
  const wheelWrap = document.createElement('div')
  wheelWrap.className = 'fm-header-color-wheel-wrap'
  wheelWrap.appendChild(wheel)
  controls.appendChild(wheelWrap)

  const shiftHueArc = (delta: number) => {
    if (state.working.type !== 'color') return
    if (Math.abs(state.working.hueTo - state.working.hueFrom) >= 360) return
    state.working.hueFrom = ((state.working.hueFrom + delta) % 360 + 360) % 360
    state.working.hueTo = ((state.working.hueTo + delta) % 360 + 360) % 360
    state.working.mode = 'color'
    syncColorControls(state)
    updateTrigger(state)
  }
  const centerHueArc = (center: number) => {
    if (state.working.type !== 'color') return
    const span = Math.abs(state.working.hueTo - state.working.hueFrom) >= 360
      ? 360
      : (state.working.hueTo - state.working.hueFrom + 360) % 360
    if (span >= 360) {
      state.working.hueFrom = 0
      state.working.hueTo = 360
    } else {
      state.working.hueFrom = Math.round((center - span / 2 + 360) % 360)
      state.working.hueTo = Math.round((state.working.hueFrom + span) % 360)
    }
    state.working.mode = 'color'
    syncColorControls(state)
    updateTrigger(state)
  }
  const centerHueArcAtPointer = (event: PointerEvent) => {
    if (state.working.type !== 'color' || state.working.mode !== 'color') return
    const rect = wheel.getBoundingClientRect()
    const angle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI
    centerHueArc((360 - angle + 360) % 360)
  }
  let wheelDragging = false
  wheel.addEventListener('pointerdown', (event) => {
    if (state.working.type !== 'color' || state.working.mode !== 'color') return
    wheelDragging = true
    wheel.setPointerCapture?.(event.pointerId)
    centerHueArcAtPointer(event)
  })
  wheel.addEventListener('pointermove', (event) => {
    if (wheelDragging) centerHueArcAtPointer(event)
  })
  const stopWheelDrag = () => { wheelDragging = false }
  wheel.addEventListener('pointerup', stopWheelDrag)
  wheel.addEventListener('pointercancel', stopWheelDrag)
  wheel.addEventListener('keydown', (event) => {
    if (state.working.type !== 'color' || state.working.mode !== 'color') return
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : 0
    if (!delta) return
    event.preventDefault()
    shiftHueArc(delta * (event.shiftKey ? 10 : 1))
  })

  const ranges = [
    { label: t('filters.hueArc'), from: 'hueFrom', to: 'hueTo', max: 360, suffix: '°' },
    { label: t('filters.saturationRange'), from: 'saturationFrom', to: 'saturationTo', max: 100, suffix: '%' },
    { label: t('filters.valueRange'), from: 'valueFrom', to: 'valueTo', max: 100, suffix: '%' },
  ] as const

  ranges.forEach((range) => {
    const group = document.createElement('div')
    group.className = 'fm-header-color-range'
    const heading = document.createElement('div')
    heading.className = 'fm-header-color-range-heading'
    heading.innerHTML = `<span>${escapeHtml(range.label)}</span><output data-color-output="${range.from}"></output>`
    group.appendChild(heading)
    const slider = document.createElement('div')
    slider.className = 'fm-header-color-dual-range'
    ;([range.from, range.to] as const).forEach((field, index) => {
      const bound = index === 0 ? t('filters.rangeStart') : t('filters.rangeEnd')
      const input = document.createElement('input')
      input.type = 'range'
      input.min = '0'
      input.max = String(range.max)
      input.step = '1'
      input.dataset.colorField = field
      input.setAttribute('aria-label', `${range.label} ${bound}`)
      input.addEventListener('input', () => {
        if (state.working.type !== 'color') return
        const next = Number(input.value)
        const hueWraps = range.from === 'hueFrom' && state.working.hueFrom > state.working.hueTo
        state.working[field] = hueWraps
          ? index === 0 ? Math.max(next, state.working[range.to]) : Math.min(next, state.working[range.from])
          : index === 0 ? Math.min(next, state.working[range.to]) : Math.max(next, state.working[range.from])
        if (range.from === 'valueFrom') {
          state.working.valuePreview = Math.max(state.working.valueFrom, Math.min(state.working.valueTo, state.working.valuePreview))
        }
        state.working.mode = 'color'
        syncColorControls(state)
        updateTrigger(state)
      })
      slider.appendChild(input)
    })
    if (range.from === 'hueFrom') {
      const grab = document.createElement('span')
      grab.className = 'fm-header-color-range-grab'
      grab.dataset.colorGrab = 'hue'
      grab.tabIndex = 0
      grab.setAttribute('role', 'slider')
      grab.setAttribute('aria-label', t('filters.moveHueArc'))
      grab.setAttribute('aria-valuemin', '0')
      grab.setAttribute('aria-valuemax', '359')
      grab.textContent = '⋯'
      let dragging = false
      let startX = 0
      grab.addEventListener('pointerdown', (event) => {
        if (state.working.type !== 'color' || state.working.mode !== 'color') return
        dragging = true
        startX = event.clientX
        grab.setPointerCapture?.(event.pointerId)
      })
      grab.addEventListener('pointermove', (event) => {
        if (!dragging) return
        const width = slider.getBoundingClientRect().width
        const travel = width - 17
        if (travel <= 0) return
        const delta = Math.round((event.clientX - startX) / travel * 360)
        if (!delta) return
        startX = event.clientX
        shiftHueArc(delta)
      })
      const stopDrag = () => { dragging = false }
      grab.addEventListener('pointerup', stopDrag)
      grab.addEventListener('pointercancel', stopDrag)
      grab.addEventListener('keydown', (event) => {
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? 1
            : 0
        if (!delta || state.working.type !== 'color' || state.working.mode !== 'color') return
        event.preventDefault()
        shiftHueArc(delta * (event.shiftKey ? 10 : 1))
      })
      slider.appendChild(grab)
    }
    if (range.from === 'valueFrom') {
      const preview = document.createElement('input')
      preview.type = 'range'
      preview.min = '0'
      preview.max = '100'
      preview.step = '1'
      preview.className = 'fm-header-color-preview-range'
      preview.dataset.colorField = 'valuePreview'
      preview.setAttribute('aria-label', t('filters.wheelPreview'))
      preview.addEventListener('input', () => {
        if (state.working.type !== 'color') return
        state.working.valuePreview = Math.max(state.working.valueFrom, Math.min(state.working.valueTo, Number(preview.value)))
        state.working.mode = 'color'
        syncColorControls(state)
        updateTrigger(state)
      })
      slider.appendChild(preview)
    }
    group.appendChild(slider)
    group.dataset.suffix = range.suffix
    controls.appendChild(group)
  })

  const transparentLabel = document.createElement('label')
  transparentLabel.className = 'fm-header-color-transparent'
  const transparentInput = document.createElement('input')
  transparentInput.type = 'checkbox'
  transparentInput.dataset.colorTransparent = ''
  transparentInput.addEventListener('change', () => {
    if (state.working.type !== 'color') return
    state.working.includeTransparent = transparentInput.checked
    updateTrigger(state)
  })
  transparentLabel.appendChild(transparentInput)
  transparentLabel.append(t('filters.includeTransparent'))
  controls.appendChild(transparentLabel)
  state.panel.appendChild(controls)
}

function buildTypedControls(state: FilterState) {
  const controls = document.createElement('div')
  controls.className = 'fm-header-filter-typed-controls'

  const operator = document.createElement('select')
  operator.className = 'fm-select fm-header-filter-operator'
  operator.setAttribute('aria-label', t('filters.filterOperator', { label: state.def.label }))

  const operators = state.def.type === 'text'
    ? TEXT_OPERATORS
    : state.def.type === 'number'
      ? NUMBER_OPERATORS
      : DATE_OPERATORS
  operator.innerHTML = operators.map((item) => `<option value="${item.value}">${t(item.labelKey)}</option>`).join('')

  const value = document.createElement('input')
  value.className = 'fm-input fm-header-filter-value'
  value.type = state.def.type === 'number' ? 'number' : state.def.type === 'date' ? 'date' : 'text'
  if (state.def.type === 'number') value.step = 'any'
  value.placeholder = t('filters.filterValue', { label: state.def.label })
  value.setAttribute('aria-label', t('filters.filterInput', { label: state.def.label }))

  const valueTo = document.createElement('input')
  valueTo.className = 'fm-input fm-header-filter-value'
  valueTo.type = state.def.type === 'number' ? 'number' : 'date'
  if (state.def.type === 'number') valueTo.step = 'any'
  valueTo.setAttribute('aria-label', t('filters.upperFilterInput', { label: state.def.label }))

  operator.addEventListener('change', () => {
    setWorkingOperator(state, operator.value)
    syncTypedInputVisibility(state)
    updateTrigger(state)
  })
  value.addEventListener('input', () => {
    if (state.working.type !== 'multi' && state.working.type !== 'color') state.working.value = value.value
    updateTrigger(state)
  })
  valueTo.addEventListener('input', () => {
    if (state.working.type === 'number' || state.working.type === 'date') state.working.valueTo = valueTo.value
    updateTrigger(state)
  })

  state.operatorSelect = operator
  state.valueInput = value
  state.valueToInput = valueTo
  controls.appendChild(operator)
  controls.appendChild(value)
  controls.appendChild(valueTo)
  state.panel.appendChild(controls)
}

function setWorkingOperator(state: FilterState, operator: string) {
  if (state.working.type === 'text') state.working.operator = operator as TextFilterOperator
  else if (state.working.type === 'number') state.working.operator = operator as NumberFilterOperator
  else if (state.working.type === 'date') state.working.operator = operator as DateFilterOperator
}

function syncControls(state: FilterState) {
  if (state.def.type === 'multi') {
    if (state.optionSearchInput) state.optionSearchInput.value = state.optionSearch
    renderMultiList(state)
    return
  }
  if (state.def.type === 'color') {
    syncColorControls(state)
    return
  }
  if (state.working.type === 'multi' || state.working.type === 'color') return
  if (state.operatorSelect) state.operatorSelect.value = state.working.operator
  if (state.valueInput) state.valueInput.value = state.working.value
  if (state.valueToInput && (state.working.type === 'number' || state.working.type === 'date')) {
    state.valueToInput.value = state.working.valueTo
  }
  syncTypedInputVisibility(state)
}

function syncColorControls(state: FilterState) {
  if (state.working.type !== 'color') return
  const value = state.working
  state.panel.querySelectorAll<HTMLInputElement>('[data-color-field]').forEach((input) => {
    const field = input.dataset.colorField as keyof ColorFilterValue
    input.value = String(value[field])
  })
  state.panel.querySelectorAll<HTMLElement>('[data-color-output]').forEach((output) => {
    const from = output.dataset.colorOutput as 'hueFrom' | 'saturationFrom' | 'valueFrom'
    const to = from.replace('From', 'To') as 'hueTo' | 'saturationTo' | 'valueTo'
    const suffix = output.closest<HTMLElement>('.fm-header-color-range')?.dataset.suffix || ''
    output.textContent = `${value[from]}${suffix}–${value[to]}${suffix}`
    const slider = output.closest<HTMLElement>('.fm-header-color-range')?.querySelector<HTMLElement>('.fm-header-color-dual-range')
    const max = Number(slider?.querySelector<HTMLInputElement>('input')?.max) || 100
    slider?.style.setProperty('--color-range-low', `${Math.min(value[from], value[to]) / max * 100}%`)
    slider?.style.setProperty('--color-range-high', `${Math.max(value[from], value[to]) / max * 100}%`)
    if (slider) slider.dataset.wrap = String(from === 'hueFrom' && value.hueFrom > value.hueTo)
  })
  state.panel.querySelectorAll<HTMLButtonElement>('[data-color-neutral]').forEach((button) => {
    const selected = value.mode === button.dataset.colorNeutral
    button.setAttribute('aria-pressed', String(selected))
    button.classList.toggle('active', selected)
  })
  const chromaticMode = value.mode === 'color'
  const controlsMuted = !chromaticMode
  const colorButton = state.panel.querySelector<HTMLButtonElement>('[data-color-mode="color"]')
  colorButton?.setAttribute('aria-pressed', String(chromaticMode))
  colorButton?.classList.toggle('active', chromaticMode)
  state.panel.querySelectorAll<HTMLElement>('.fm-header-color-range').forEach((range) => range.classList.toggle('is-muted', controlsMuted))
  state.panel.querySelectorAll<HTMLInputElement>('[data-color-field]').forEach((input) => { input.disabled = controlsMuted })
  const hueGrab = state.panel.querySelector<HTMLElement>('[data-color-grab="hue"]')
  if (hueGrab) {
    hueGrab.tabIndex = controlsMuted ? -1 : 0
    hueGrab.setAttribute('aria-disabled', String(controlsMuted))
  }
  const transparent = state.panel.querySelector<HTMLInputElement>('[data-color-transparent]')
  if (transparent) {
    transparent.checked = value.includeTransparent
    transparent.closest('.fm-header-color-transparent')?.classList.toggle(
      'is-muted',
      value.mode === 'none' && !value.includeTransparent,
    )
  }
  const wheel = state.panel.querySelector<HTMLElement>('.fm-header-color-wheel')
  if (wheel) {
    const hueSpan = Math.abs(value.hueTo - value.hueFrom) >= 360
      ? 360
      : (value.hueTo - value.hueFrom + 360) % 360
    wheel.style.setProperty('--color-hue-from', `${90 - value.hueTo}deg`)
    wheel.style.setProperty('--color-hue-span', `${hueSpan}deg`)
    wheel.style.setProperty('--color-saturation-inner', `${Math.min(value.saturationFrom, value.saturationTo)}%`)
    wheel.style.setProperty('--color-saturation-outer', `${Math.max(value.saturationFrom, value.saturationTo)}%`)
    wheel.style.setProperty('--color-wheel-darkness', String(1 - value.valuePreview / 100))
    wheel.classList.toggle('is-muted', controlsMuted)
    wheel.tabIndex = controlsMuted ? -1 : 0
    wheel.setAttribute('aria-disabled', String(controlsMuted))
    wheel.setAttribute('aria-valuenow', String(Math.round((value.hueFrom + hueSpan / 2) % 360)))
    wheel.setAttribute('aria-valuetext', `${value.hueFrom}°–${value.hueTo}°`)
    const selection = wheel.querySelector<HTMLElement>('.fm-header-color-wheel-selection')
    if (selection) selection.hidden = controlsMuted
  }
  const hueSpan = Math.abs(value.hueTo - value.hueFrom) >= 360 ? 360 : (value.hueTo - value.hueFrom + 360) % 360
  const hueCenter = (value.hueFrom + hueSpan / 2) % 360
  if (hueGrab) {
    const ratio = hueCenter / 360
    hueGrab.style.left = `calc(${(ratio * 100).toFixed(4)}% + ${(8.5 * (1 - 2 * ratio)).toFixed(4)}px)`
    hueGrab.hidden = controlsMuted || value.hueFrom > value.hueTo
    hueGrab.setAttribute('aria-valuenow', String(Math.round(hueCenter)))
    hueGrab.setAttribute('aria-valuetext', `${value.hueFrom}°–${value.hueTo}°`)
  }
}

function syncTypedInputVisibility(state: FilterState) {
  if (state.working.type === 'multi' || state.working.type === 'color') return
  const noValue = state.working.operator === 'isEmpty' || state.working.operator === 'isNotEmpty'
  const between = state.working.operator === 'between'
  if (state.valueInput) state.valueInput.style.display = noValue ? 'none' : ''
  if (state.valueToInput) state.valueToInput.style.display = !noValue && between ? '' : 'none'
}

function visibleOptions(state: FilterState): HeaderFilterOption[] {
  const query = state.optionSearch.toLowerCase().trim()
  return query
    ? state.options.filter((option) => option.label.toLowerCase().includes(query))
    : state.options
}

function updateVisibleMultiOptions(state: FilterState, selected: boolean) {
  if (state.working.type !== 'multi') return
  const values = new Set(state.working.values)
  visibleOptions(state).forEach((option) => selected ? values.add(option.value) : values.delete(option.value))
  state.working.values = [...values]
  renderMultiList(state)
  updateTrigger(state)
}

function renderMultiList(state: FilterState) {
  if (!state.list || state.working.type !== 'multi') return
  const options = state.def.multiDisplay === 'colors' && state.optionView === 'swatches'
    ? [...visibleOptions(state)].sort(compareColorOptions)
    : visibleOptions(state)
  state.list.classList.toggle('fm-header-filter-color-grid', state.def.multiDisplay === 'colors' && state.optionView === 'swatches')
  if (options.length === 0) {
    state.list.innerHTML = `<div class="fm-header-filter-empty-text">${escapeHtml(t('filters.noMatchingOptions'))}</div>`
    return
  }
  const selected = new Set(state.working.values)
  state.list.innerHTML = options.map((option) => {
    const checked = selected.has(option.value) ? 'checked' : ''
    const swatches = renderOptionSwatches(option)
    if (state.def.multiDisplay === 'colors' && state.optionView === 'swatches') {
      return `<label class="fm-header-filter-color-option" title="${escapeHtml(option.label)}"><input type="checkbox" data-value="${escapeHtml(option.value)}" ${checked} /><span class="fm-header-filter-color-tile">${swatches || '<span class="fm-header-filter-empty-swatch">&mdash;</span>'}</span><span class="fm-sr-only">${escapeHtml(option.label)}</span></label>`
    }
    return `<label class="fm-header-filter-option"><input type="checkbox" data-value="${escapeHtml(option.value)}" ${checked} />${swatches}<span>${escapeHtml(option.label)}</span></label>`
  }).join('')
  state.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (state.working.type !== 'multi') return
      const values = new Set(state.working.values)
      const optionValue = input.dataset.value || ''
      if (input.checked) values.add(optionValue)
      else values.delete(optionValue)
      state.working.values = [...values]
      updateTrigger(state)
    })
  })
}

function renderOptionSwatches(option: HeaderFilterOption): string {
  const colors = (option.colorHexes || []).map(normalizeHex).filter((hex): hex is string => Boolean(hex))
  if (colors.length === 0) return ''
  return `<span class="fm-header-filter-color-dots" aria-hidden="true">${colors.map((hex) =>
    `<span class="fm-header-filter-color-dot" style="background:${hex}"></span>`).join('')}</span>`
}

function normalizeHex(value: string): string | null {
  return toOpaqueRgbHex(value, '') || null
}

function compareColorOptions(a: HeaderFilterOption, b: HeaderFilterOption): number {
  const aSort = colorSortKey(a.colorHexes?.[0])
  const bSort = colorSortKey(b.colorHexes?.[0])
  for (let index = 0; index < aSort.length; index++) {
    if (aSort[index] !== bSort[index]) return aSort[index] - bSort[index]
  }
  return a.label.localeCompare(b.label)
}

function colorSortKey(value?: string): [number, number, number, number] {
  const hex = value ? normalizeHex(value) : null
  if (!hex) return [2, 0, 0, 0]
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue = (hue * 60 + 360) % 360
  }
  // Neutrals read best as a dark-to-light strip before the hue wheel.
  return saturation < 0.12
    ? [0, 0, Math.round(lightness * 1000), 0]
    : [1, Math.round(hue * 10), Math.round(lightness * 1000), Math.round(saturation * 1000)]
}

function updateTrigger(state: FilterState) {
  // For multi filters that default to "all selected", only flag as active once something is deselected.
  const active = state.def.type === 'multi' && state.applied.type === 'multi' && state.options.length > 0
    ? state.applied.values.length > 0 && state.applied.values.length < state.options.length
    : isColumnFilterActive(state.applied)
  const pending = !sameFilter(state.applied, state.working)
  state.trigger.classList.toggle('active', active)
  state.trigger.classList.toggle('pending', pending)
  state.trigger.setAttribute(
    'aria-label',
    t(active ? 'filters.filterColumnActive' : 'filters.filterColumn', { label: state.def.label }),
  )
}
