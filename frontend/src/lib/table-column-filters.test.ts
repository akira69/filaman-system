import { describe, expect, it } from 'vitest'

import {
  systemExtraFieldFilterType,
  systemExtraFieldFilterValue,
} from './table-column-filters'

describe('System Extra Field table filters', () => {
  it.each([
    ['number', 'number'],
    ['float', 'number'],
    ['date', 'date'],
    ['dropdown', 'multi'],
    ['multiselect', 'multi'],
    ['checkbox', 'multi'],
    ['text', 'text'],
    ['textarea', 'text'],
    ['url', 'text'],
    ['range', 'text'],
    ['formula', 'text'],
    ['unknown', 'text'],
  ] as const)('maps %s fields to %s filters', (fieldType, filterType) => {
    expect(systemExtraFieldFilterType(fieldType)).toBe(filterType)
  })

  it('normalizes checkbox values for the Yes/No multi-select', () => {
    const field = { key: 'approved', label: 'Approved', field_type: 'checkbox' }
    expect(systemExtraFieldFilterValue(field, true)).toBe('true')
    expect(systemExtraFieldFilterValue(field, 'true')).toBe('true')
    expect(systemExtraFieldFilterValue(field, false)).toBe('false')
    expect(systemExtraFieldFilterValue(field, null)).toBe('false')
  })

  it('turns structured ranges into searchable text', () => {
    const field = { key: 'temperature', label: 'Temperature', field_type: 'range' }
    expect(systemExtraFieldFilterValue(field, { min: 190, max: 220 })).toBe('190 – 220')
  })

  it('keeps multi-select arrays intact for any-option matching', () => {
    const field = { key: 'tags', label: 'Tags', field_type: 'multiselect' }
    expect(systemExtraFieldFilterValue(field, ['dry', 'abrasive'])).toEqual(['dry', 'abrasive'])
  })
})
