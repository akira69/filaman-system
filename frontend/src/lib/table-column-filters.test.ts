import { describe, expect, it } from 'vitest'

import {
  matchesColumnFilter,
  normalizeColorFilter,
  systemExtraFieldFilterType,
  systemExtraFieldFilterValue,
  type ColorFilterValue,
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

describe('Color range table filters', () => {
  it('normalizes restored color state to one neutral mode', () => {
    expect(normalizeColorFilter({
      type: 'color',
      chromatic: true,
      hueFrom: 10,
      hueTo: 45,
      saturationFrom: 20,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: false,
      neutrals: ['black', 'white'],
    })).toEqual(expect.objectContaining({ chromatic: false, neutrals: ['black'] }))
  })

  it('matches chromatic colors inside the hue arc and saturation radii', () => {
    const filter = {
      type: 'color',
      chromatic: true,
      hueFrom: 10,
      hueTo: 45,
      saturationFrom: 25,
      saturationTo: 90,
      valueFrom: 60,
      valueTo: 80,
      valuePreview: 80,
      includeTransparent: false,
      neutrals: [],
    } satisfies ColorFilterValue

    expect(matchesColumnFilter(['#A64B1B'], filter)).toBe(true)
    expect(matchesColumnFilter(['#A64B1B80'], filter)).toBe(true)
    expect(matchesColumnFilter(['#FF8A33'], filter)).toBe(false)
    expect(matchesColumnFilter(['#FFCCCC'], filter)).toBe(false)
    expect(matchesColumnFilter(['#00FF00'], filter)).toBe(false)
  })

  it('supports hue arcs that wrap through zero degrees', () => {
    const filter = {
      type: 'color',
      chromatic: true,
      hueFrom: 330,
      hueTo: 20,
      saturationFrom: 50,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: false,
      neutrals: [],
    } satisfies ColorFilterValue

    expect(matchesColumnFilter(['#FF0000'], filter)).toBe(true)
    expect(matchesColumnFilter(['#00FF00'], filter)).toBe(false)
  })

  it('matches only the selected soft neutral family', () => {
    const base = {
      type: 'color',
      chromatic: false,
      hueFrom: 0,
      hueTo: 60,
      saturationFrom: 20,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: false,
    } satisfies Omit<ColorFilterValue, 'neutrals'>

    expect(matchesColumnFilter(['#262626'], { ...base, neutrals: ['black'] })).toBe(true)
    expect(matchesColumnFilter(['#FFF5E6'], { ...base, neutrals: ['black'] })).toBe(false)
    expect(matchesColumnFilter(['#FFF5E6'], { ...base, neutrals: ['white'] })).toBe(true)
    expect(matchesColumnFilter(['#808080'], { ...base, neutrals: ['white'] })).toBe(false)
    expect(matchesColumnFilter(['#808080'], { ...base, neutrals: ['grey'] })).toBe(true)
    expect(matchesColumnFilter(['#262626'], { ...base, neutrals: ['grey'] })).toBe(false)
    expect(matchesColumnFilter(['not-a-color'], { ...base, neutrals: ['grey'] })).toBe(false)
  })

  it('optionally includes colors with a non-opaque alpha channel', () => {
    const filter = {
      type: 'color',
      chromatic: false,
      hueFrom: 0,
      hueTo: 360,
      saturationFrom: 0,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: true,
      neutrals: [],
    } satisfies ColorFilterValue

    expect(matchesColumnFilter(['#0066CC80'], filter)).toBe(true)
    expect(matchesColumnFilter(['#0066CCFE'], filter)).toBe(true)
    expect(matchesColumnFilter(['#0066CC'], filter)).toBe(false)
  })
})
