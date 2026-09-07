import { createDefaultLabelDesign } from './defaults'
import { getStandardLabelPresets } from './standard-presets'
import { normalizeLabelDesign } from './normalize'
import type { FreeformEditorController } from './editor-state'
import type { LabelDesignV2, LabelDesignerPresetData, LabelKind } from './types'

export const activeEditors = new Map<string, FreeformEditorController>()

function readJsonObject(key: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function persistFreeformLabelDesign(settingsKey: string, design: LabelDesignV2) {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({ version: 2, design }))
    return true
  } catch {
    return false
  }
}

export function loadStoredFreeformLabelDesign(options: {
  settingsKey: string
  presetsKey: string
  kind: LabelKind
}): LabelDesignV2 {
  const working = readJsonObject(options.settingsKey)
  if (working?.version === 2 && working.design) {
    return normalizeLabelDesign(working.design)
  }

  const cache = readJsonObject(options.presetsKey)
  const presets = Array.isArray(cache?.presets) ? cache.presets : []
  for (const candidate of presets) {
    if (!candidate || typeof candidate !== 'object') continue
    const data = (candidate as { data?: unknown }).data
    if (!data || typeof data !== 'object') continue
    const preset = data as { version?: unknown; design?: unknown }
    if (preset.version === 2 && preset.design) return normalizeLabelDesign(preset.design)
  }
  return createDefaultLabelDesign(options.kind)
}

export function loadFreeformLabelDesign(options: {
  settingsKey: string
  presetsKey: string
  kind: LabelKind
}): LabelDesignV2 {
  const active = activeEditors.get(options.settingsKey)
  return active?.getDesign() ?? loadStoredFreeformLabelDesign(options)
}

export interface StoredPreset {
  name: string
  data: LabelDesignerPresetData
  settings?: unknown
}

export function readStoredPresets(storageKey: string): StoredPreset[] {
  const value = readJsonObject(storageKey)
  const presets = Array.isArray(value?.presets) ? value.presets : []
  return presets.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return []
    const { name, data, settings } = candidate as { name?: unknown; data?: unknown; settings?: unknown }
    if (typeof name !== 'string' || !data || typeof data !== 'object') return []
    const payload = data as { version?: unknown; design?: unknown; legacy_v1?: unknown }
    if (payload.version !== 2 || !payload.design) return []
    const normalizedData: LabelDesignerPresetData = {
      version: 2,
      design: normalizeLabelDesign(payload.design),
    }
    if ('legacy_v1' in payload) normalizedData.legacy_v1 = structuredClone(payload.legacy_v1)
    return [{
      name,
      data: normalizedData,
      settings: settings === undefined ? normalizedData.legacy_v1 : structuredClone(settings),
    }]
  })
}

export function getFreeformLabelPresetNames(storageKey: string) {
  return [...new Set([
    ...readStoredPresets(storageKey).map(preset => preset.name),
    ...getStandardLabelPresets().map(preset => preset.name),
  ])]
}

export function loadFreeformLabelPresetDesign(options: {
  presetsKey: string
  presetName: string
  kind: LabelKind
}): LabelDesignV2 | null {
  const preset = readStoredPresets(options.presetsKey)
    .find(candidate => candidate.name === options.presetName)
    ?? getStandardLabelPresets().find(candidate => candidate.name === options.presetName)
  return preset ? normalizeLabelDesign(preset.data.design) : null
}

function writeStoredPresets(storageKey: string, presets: StoredPreset[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      presets: presets.map(preset => ({
        ...preset,
        settings: preset.settings ?? preset.data.legacy_v1 ?? {},
      })),
    }))
    return true
  } catch {
    return false
  }
}

export async function persistStoredPresetMutation(
  storageKey: string,
  presets: StoredPreset[],
  mutateDatabase: () => Promise<boolean>,
) {
  let previous: string | null
  try {
    previous = localStorage.getItem(storageKey)
  } catch {
    return false
  }
  if (!writeStoredPresets(storageKey, presets)) return false
  try {
    if (await mutateDatabase()) return true
  } catch {
    // Treat an unexpected request rejection like a reported database failure.
  }
  try {
    if (previous === null) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, previous)
  } catch {
    // The failed database mutation is still reported to the user.
  }
  return false
}
