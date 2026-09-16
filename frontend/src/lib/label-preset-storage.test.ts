import { describe, expect, it, vi } from 'vitest'

import { buildDesignerPresetCache, buildLabelPresetUpsertBody, saveLabelPreset } from './label-preset-storage'
import { createDefaultLabelDesign } from './freeform-label/defaults'
import { api } from './api'

describe('label preset cache migration', () => {
  it('isolates unsupported presets and prevents overwriting them by name', async () => {
    const future = { version: 3, design: { version: 3, elements: [{ type: 'future' }] } }
    const original = structuredClone(future)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const put = vi.spyOn(api, 'put').mockResolvedValue({})
    try {
      const cache = buildDesignerPresetCache([
        { id: 1, preset_type: 'spool', name: 'Future', data: future },
        { id: 2, preset_type: 'spool', name: 'Usable', data: { settings: { label: { width: 72 } } } },
      ], 'spool')
      expect(cache.presets.map(preset => preset.name)).toEqual(['Usable'])
      expect(cache.presets[0].data.design.label.widthMm).toBe(72)
      expect(future).toEqual(original)
      expect(warning).toHaveBeenCalled()
      expect(await saveLabelPreset('filaman-spool-label-presets-v1', { name: 'Future', settings: {} })).toBe(false)
      expect(put).not.toHaveBeenCalled()
    } finally {
      warning.mockRestore()
      put.mockRestore()
      buildDesignerPresetCache([], 'spool')
    }
  })

  it('exposes normalized v2 data while retaining legacy settings for the compatibility editor', () => {
    const legacy = {
      label: { width: 72, height: 35, marginMm: 2, border: true },
      title: { template: '{filament.name}' },
    }
    let nativeId = 0
    const nativeV2 = {
      version: 2 as const,
      design: createDefaultLabelDesign('spool', () => `native-${++nativeId}`),
    }

    const cache = buildDesignerPresetCache([
      { id: 1, preset_type: 'spool', name: 'Legacy', data: { settings: legacy } },
      { id: 2, preset_type: 'spool', name: 'Native', data: nativeV2 },
      { id: 3, preset_type: 'filament', name: 'Wrong kind', data: { settings: legacy } },
    ], 'spool')

    expect(cache.version).toBe(2)
    expect(cache.presets.map(preset => preset.name)).toEqual(['Legacy', 'Native'])
    expect(cache.presets[0].settings).toEqual(legacy)
    expect(cache.presets[0].data).toMatchObject({ version: 2, legacy_v1: legacy })
    expect(cache.presets[0].data.design.label).toMatchObject({ widthMm: 72, heightMm: 35 })
    expect(cache.presets[1].data).toEqual(nativeV2)
    expect(cache.presets[1].settings).toEqual({})
  })

  it('saves native v2 designer data without changing the sheet or legacy API shapes', () => {
    let id = 0
    const data = {
      version: 2 as const,
      design: createDefaultLabelDesign('spool', () => `id-${++id}`),
    }

    expect(buildLabelPresetUpsertBody('filaman-spool-label-presets-v1', {
      name: 'Freeform',
      data,
    }, 'Old name')).toEqual({
      name: 'Freeform',
      previous_name: 'Old name',
      data,
    })
    expect(buildLabelPresetUpsertBody('filaman-filament-label-presets-v1', {
      name: 'Legacy',
      settings: { label: { width: 50 } },
    })).toEqual({
      name: 'Legacy',
      previous_name: undefined,
      data: { settings: { label: { width: 50 } } },
    })
    expect(buildLabelPresetUpsertBody('filaman-label-sheet-presets-v1', {
      id: 'sheet-id',
      name: 'Sheet',
      settings: { rows: 8 },
    })).toEqual({
      name: 'Sheet',
      previous_name: undefined,
      data: { id: 'sheet-id', settings: { rows: 8 } },
    })
  })
})
