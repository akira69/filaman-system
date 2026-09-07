import { describe, expect, it } from 'vitest'

import { migrateV1PresetData, normalizeDesignerPresetData } from './migrate-v1'
import { createDefaultLabelDesign } from './defaults'

describe('v1 label designer migration', () => {
  it('converts each visible legacy section into an editable v2 element and retains the source', () => {
    const legacy = {
      label: { width: 60, height: 40, marginMm: 1, border: true },
      logo: { show: true, spaceMm: 6, scaleToFit: true, manualSizeMm: 6, align: 'left' },
      title: { show: true, sizeMm: 4, marginMm: 0, fitToWidth: true, align: 'center', template: '{filament.name}', dividerAbove: false, dividerBelow: true },
      title2: { show: false },
      qr: { show: true, mode: 'logo', sizeMm: 18, position: 'right', vAlign: 'bottom', linkMode: 'spool', urlTemplate: '' },
      info: { show: true, sizeMm: 2.5, marginMm: 0, hAlign: 'left', vAlign: 'bottom', template: '{filament.type}\n{id}' },
      info2: { show: false },
    }
    const source = structuredClone(legacy)
    const ids = ['logo', 'title', 'divider', 'qr', 'info']

    const preset = migrateV1PresetData({ settings: legacy }, 'spool', () => ids.shift()!)

    expect(preset.version).toBe(2)
    expect(preset.legacy_v1).toEqual(source)
    expect(preset.design.label).toEqual({ widthMm: 60, heightMm: 40, marginMm: 1, border: true })
    expect(preset.design.elements.map(element => element.type)).toEqual([
      'manufacturerLogo',
      'text',
      'shape',
      'qr',
      'text',
    ])
    expect(preset.design.elements.map(element => element.id)).toEqual([
      'logo',
      'title',
      'divider',
      'qr',
      'info',
    ])
    expect(preset.design.elements.filter(element => element.type === 'text').map(element => element.template)).toEqual([
      '{filament.name}',
      '{filament.type}\n{id}',
    ])
    expect(preset.design.elements.find(element => element.type === 'shape')?.h).toBe(0.3)
    expect(preset.design.elements.find(element => element.id === 'title')).toMatchObject({ fitToWidth: true })
    expect(normalizeDesignerPresetData(preset, 'spool').design.elements.find(element => element.id === 'title')).toMatchObject({ fitToWidth: true })
    expect(legacy).toEqual(source)
  })

  it('normalizes a v2 preset idempotently without adding legacy data', () => {
    const raw = {
      version: 2 as const,
      design: createDefaultLabelDesign('filament', () => `id-${Math.random()}`),
    }
    const snapshot = structuredClone(raw)

    const first = normalizeDesignerPresetData(raw, 'filament')
    const second = normalizeDesignerPresetData(first, 'filament')

    expect(second).toEqual(first)
    expect(first).not.toHaveProperty('legacy_v1')
    expect(raw).toEqual(snapshot)
  })

  it('keeps the oldest hidden QR mode hidden instead of restoring a default QR', () => {
    const preset = migrateV1PresetData({
      label: { width: 60, height: 40 },
      logo: { show: false },
      title: { show: false },
      title2: { show: false },
      qr: { mode: 'none' },
      info: { show: false },
      info2: { show: false },
    }, 'spool')

    expect(preset.design.elements).toEqual([])
  })

  it.each([
    { version: 3, design: { version: 3, elements: [] } },
    { version: 2, design: { version: 3, elements: [] } },
    { version: 2 },
  ])('rejects unsupported envelopes without interpreting them as legacy settings', raw => {
    const original = structuredClone(raw)
    expect(() => normalizeDesignerPresetData(raw, 'spool')).toThrow(/unsupported/i)
    expect(raw).toEqual(original)
  })
})
