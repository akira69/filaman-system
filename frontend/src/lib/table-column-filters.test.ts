import { describe, expect, it } from 'vitest'

import {
  colorWheelPixels,
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
  it('renders continuous HSV colors through every wheel axis', () => {
    const pixels = colorWheelPixels(5)
    const pixel = (x: number, y: number) => [...pixels.slice((y * 5 + x) * 4, (y * 5 + x + 1) * 4)]

    expect(pixel(2, 2)).toEqual([255, 255, 255, 255])
    expect([pixel(4, 2), pixel(2, 0), pixel(0, 2), pixel(2, 4)]).toEqual([
      [255, 51, 51, 255],
      [153, 255, 51, 255],
      [51, 255, 255, 255],
      [153, 51, 255, 255],
    ])
    expect(pixel(0, 0)).toEqual([0, 0, 0, 0])
  })

  it('migrates restored color state to one valid mode', () => {
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
    })).toEqual(expect.objectContaining({ mode: 'black' }))
  })

  it('ignores malformed legacy neutral state', () => {
    expect(normalizeColorFilter({
      type: 'color', chromatic: true, neutrals: 'black',
      hueFrom: 10, hueTo: 45, saturationFrom: 20, saturationTo: 100,
      valueFrom: 0, valueTo: 100, valuePreview: 100, includeTransparent: false,
    })).toEqual(expect.objectContaining({ mode: 'color' }))
  })

  it('matches chromatic colors inside the hue arc and saturation radii', () => {
    const filter = {
      type: 'color',
      mode: 'color',
      hueFrom: 10,
      hueTo: 45,
      saturationFrom: 25,
      saturationTo: 90,
      valueFrom: 60,
      valueTo: 80,
      valuePreview: 80,
      includeTransparent: false,
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
      mode: 'color',
      hueFrom: 330,
      hueTo: 20,
      saturationFrom: 50,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: false,
    } satisfies ColorFilterValue

    expect(matchesColumnFilter(['#FF0000'], filter)).toBe(true)
    expect(matchesColumnFilter(['#00FF00'], filter)).toBe(false)
  })

  it('matches only the selected soft neutral family', () => {
    const base = {
      type: 'color',
      mode: 'none',
      hueFrom: 0,
      hueTo: 60,
      saturationFrom: 20,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: false,
    } satisfies ColorFilterValue

    expect(matchesColumnFilter(['#262626'], { ...base, mode: 'black' })).toBe(true)
    expect(matchesColumnFilter(['#FFF5E6'], { ...base, mode: 'black' })).toBe(false)
    expect(matchesColumnFilter(['#FFF5E6'], { ...base, mode: 'white' })).toBe(true)
    expect(matchesColumnFilter(['#808080'], { ...base, mode: 'white' })).toBe(false)
    expect(matchesColumnFilter(['#808080'], { ...base, mode: 'grey' })).toBe(true)
    expect(matchesColumnFilter(['#262626'], { ...base, mode: 'grey' })).toBe(false)
    expect(matchesColumnFilter(['not-a-color'], { ...base, mode: 'grey' })).toBe(false)
  })

  it('optionally includes colors with a non-opaque alpha channel', () => {
    const filter = {
      type: 'color',
      mode: 'none',
      hueFrom: 0,
      hueTo: 360,
      saturationFrom: 0,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 100,
      valuePreview: 100,
      includeTransparent: true,
    } satisfies ColorFilterValue

    expect(matchesColumnFilter(['#0066CC80'], filter)).toBe(true)
    expect(matchesColumnFilter(['#0066CCFE'], filter)).toBe(true)
    expect(matchesColumnFilter(['#0066CC'], filter)).toBe(false)
  })
})

describe('Date table filters', () => {
  it('matches timestamps by the date displayed in the local timezone', () => {
    const timestamp = '2026-09-12T01:00:00Z'
    const local = new Date(timestamp)
    const displayedDate = [
      local.getFullYear(),
      String(local.getMonth() + 1).padStart(2, '0'),
      String(local.getDate()).padStart(2, '0'),
    ].join('-')

    expect(matchesColumnFilter(timestamp, {
      type: 'date', operator: 'on', value: displayedDate, valueTo: '',
    })).toBe(true)
  })
})
