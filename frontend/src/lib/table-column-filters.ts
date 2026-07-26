import { t } from './i18n'
import type { SystemExtraFieldDef } from './extra-fields'

export type HeaderFilterOption = {
  value: string
  label: string
  colorHexes?: string[]
}

export type TextFilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'notContains' | 'isEmpty' | 'isNotEmpty'
export type NumberFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'isEmpty' | 'isNotEmpty'
export type DateFilterOperator = 'on' | 'before' | 'after' | 'between' | 'isEmpty' | 'isNotEmpty'

export type ColumnFilterValue =
  | { type: 'multi'; values: string[] }
  | { type: 'text'; operator: TextFilterOperator; value: string }
  | { type: 'number'; operator: NumberFilterOperator; value: string; valueTo: string }
  | { type: 'date'; operator: DateFilterOperator; value: string; valueTo: string }

export type HeaderFilterDefinition = {
  key: string
  label: string
  columnSelector: string
  type: ColumnFilterValue['type']
  multiDisplay?: 'default' | 'colors'
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

export function emptyColumnFilter(type: ColumnFilterValue['type']): ColumnFilterValue {
  if (type === 'multi') return { type, values: [] }
  if (type === 'text') return { type, operator: 'contains', value: '' }
  if (type === 'number') return { type, operator: 'eq', value: '', valueTo: '' }
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

function normalizeDate(value: unknown): string {
  if (!value) return ''
  const text = String(value)
  const match = text.match(/^\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function cloneFilter(value: ColumnFilterValue): ColumnFilterValue {
  if (value.type === 'multi') return { type: 'multi', values: [...value.values] }
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
    trigger.setAttribute('aria-label', `Filter ${def.label}`)
    trigger.setAttribute('aria-expanded', 'false')
    trigger.title = `Filter ${def.label}`
    trigger.innerHTML = FILTER_ICON

    const panel = document.createElement('div')
    panel.className = 'fm-header-filter-panel'

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
      ;(state.optionSearchInput || state.valueInput || state.operatorSelect)?.focus()
    })

    panel.addEventListener('click', (event) => event.stopPropagation())
    panel.addEventListener('dragstart', (event) => event.preventDefault())

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
  search.setAttribute('aria-label', `Search ${state.def.label} options`)

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

function buildTypedControls(state: FilterState) {
  const controls = document.createElement('div')
  controls.className = 'fm-header-filter-typed-controls'

  const operator = document.createElement('select')
  operator.className = 'fm-select fm-header-filter-operator'
  operator.setAttribute('aria-label', `${state.def.label} filter operator`)

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
  value.setAttribute('aria-label', `${state.def.label} filter value`)

  const valueTo = document.createElement('input')
  valueTo.className = 'fm-input fm-header-filter-value'
  valueTo.type = state.def.type === 'number' ? 'number' : 'date'
  if (state.def.type === 'number') valueTo.step = 'any'
  valueTo.setAttribute('aria-label', `${state.def.label} upper filter value`)

  operator.addEventListener('change', () => {
    setWorkingOperator(state, operator.value)
    syncTypedInputVisibility(state)
    updateTrigger(state)
  })
  value.addEventListener('input', () => {
    if (state.working.type !== 'multi') state.working.value = value.value
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
  if (state.working.type === 'multi') return
  if (state.operatorSelect) state.operatorSelect.value = state.working.operator
  if (state.valueInput) state.valueInput.value = state.working.value
  if (state.valueToInput && (state.working.type === 'number' || state.working.type === 'date')) {
    state.valueToInput.value = state.working.valueTo
  }
  syncTypedInputVisibility(state)
}

function syncTypedInputVisibility(state: FilterState) {
  if (state.working.type === 'multi') return
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
  const hex = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${hex.split('').map((part) => part + part).join('').toUpperCase()}`
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`
  return null
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
  const active = isColumnFilterActive(state.applied)
  const pending = !sameFilter(state.applied, state.working)
  state.trigger.classList.toggle('active', active)
  state.trigger.classList.toggle('pending', pending)
  state.trigger.setAttribute('aria-label', active ? `Filter ${state.def.label}, active` : `Filter ${state.def.label}`)
}
