import {
  clearBrowserPresetMigrationState,
  completeBrowserPresetMigration,
  FILAMENT_LABEL_PRESETS_KEY,
  LABEL_SHEET_PRESETS_KEY,
  needsBrowserPresetMigration,
  prepareLegacySpoolPresetFallback,
  readBrowserPresetsForMigration,
  SPOOL_LABEL_PRESETS_KEY,
} from './label-preset-browser-migration'
import { api } from './api'
import { normalizeDesignerPresetData } from './freeform-label/migrate-v1'
import type { LabelDesignerPresetData, LabelKind } from './freeform-label/types'

export {
  FILAMENT_LABEL_PRESETS_KEY,
  LABEL_SHEET_PRESETS_KEY,
  SPOOL_LABEL_PRESETS_KEY,
} from './label-preset-browser-migration'

type PresetType = 'spool' | 'filament' | 'sheet'

type ApiLabelPreset = {
  id: number
  preset_type: PresetType
  name: string
  data: Record<string, unknown>
}

export interface CachedDesignerPreset {
  name: string
  data: LabelDesignerPresetData
  /** Temporary v1 editor bridge; remove with the legacy compatibility module. */
  settings: unknown
}

export interface DesignerPresetCache {
  version: 2
  presets: CachedDesignerPreset[]
}

let hydrationPromise: Promise<void> | null = null
const PRESET_OWNER_KEY = 'filaman-label-presets-owner-v1'
const unsupportedPresetNames = new Map<LabelKind, Set<string>>()

function safeWrite(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function buildDesignerPresetCache(
  presets: ApiLabelPreset[],
  presetType: LabelKind,
): DesignerPresetCache {
  const unsupportedNames = new Set<string>()
  unsupportedPresetNames.set(presetType, unsupportedNames)
  return {
    version: 2,
    presets: presets
      .filter(preset => preset.preset_type === presetType)
      .flatMap(preset => {
        try {
          const data = normalizeDesignerPresetData(preset.data, presetType)
          return [{
            name: preset.name,
            data,
            settings: data.legacy_v1 ?? {},
          }]
        } catch (error) {
          unsupportedNames.add(preset.name)
          console.warn(`Could not load label preset "${preset.name}"; its database data is unchanged`, error)
          return []
        }
      }),
  }
}

function writeDatabasePresetsToBrowser(presets: ApiLabelPreset[]) {
  safeWrite(SPOOL_LABEL_PRESETS_KEY, buildDesignerPresetCache(presets, 'spool'))
  safeWrite(FILAMENT_LABEL_PRESETS_KEY, buildDesignerPresetCache(presets, 'filament'))
  safeWrite(LABEL_SHEET_PRESETS_KEY, presets
    .filter(preset => preset.preset_type === 'sheet' && preset.data.settings)
    .map(preset => ({
      id: typeof preset.data.id === 'string' ? preset.data.id : `database-${preset.id}`,
      name: preset.name,
      settings: preset.data.settings,
    })))
}

async function fetchPresetDatabase(): Promise<ApiLabelPreset[]> {
  const needsMigration = needsBrowserPresetMigration()
  if (needsMigration) prepareLegacySpoolPresetFallback()
  const presets = needsMigration
    ? await api.post<ApiLabelPreset[]>('/me/label-presets/migrate', {
        presets: readBrowserPresetsForMigration(),
      })
    : await api.get<ApiLabelPreset[]>('/me/label-presets')
  if (needsMigration) completeBrowserPresetMigration()
  return presets
}

function removePresetBrowserValues(clearMigrationState = true) {
  unsupportedPresetNames.clear()
  for (const key of [
    SPOOL_LABEL_PRESETS_KEY,
    FILAMENT_LABEL_PRESETS_KEY,
    LABEL_SHEET_PRESETS_KEY,
  ]) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Browser storage is an optional cache.
    }
  }
  if (clearMigrationState) clearBrowserPresetMigrationState()
}

function preparePresetOwner(userId: number) {
  const nextOwner = String(userId)
  let previousOwner: string | null = null
  try {
    previousOwner = localStorage.getItem(PRESET_OWNER_KEY)
  } catch {
    return
  }
  // No marker means these may be legacy browser-only presets awaiting first migration.
  if (previousOwner !== null && previousOwner !== nextOwner) removePresetBrowserValues()
  try {
    localStorage.setItem(PRESET_OWNER_KEY, nextOwner)
  } catch {
    // Database persistence still works without a browser cache.
  }
}

export function clearLabelPresetBrowserStorage() {
  // Preserve legacy browser-only presets when their database migration has not succeeded yet.
  if (needsBrowserPresetMigration()) {
    hydrationPromise = null
    return
  }
  // Keep the owner and completed migration marker. A subsequent login by the same
  // account can skip migration; a different account is detected and reset above.
  removePresetBrowserValues(false)
  hydrationPromise = null
}

export async function ensureLabelPresetBrowserMigration(userId: number): Promise<void> {
  if (!needsBrowserPresetMigration()) return
  await hydrateLabelPresetStorage(userId)
}

export function hydrateLabelPresetStorage(userId?: number): Promise<void> {
  if (!hydrationPromise) {
    const resolvedUserId = userId === undefined
      ? api.get<{ id: number }>('/me').then(user => user.id)
      : Promise.resolve(userId)
    hydrationPromise = resolvedUserId
      .then(id => {
        preparePresetOwner(id)
        return fetchPresetDatabase()
      })
      .then(writeDatabasePresetsToBrowser)
      .catch((error) => {
        hydrationPromise = null
        console.warn('Could not load label presets from the database; using browser fallback', error)
      })
  }
  return hydrationPromise
}

function presetTypeForStorageKey(storageKey: string): PresetType | null {
  if (storageKey === SPOOL_LABEL_PRESETS_KEY) return 'spool'
  if (storageKey === FILAMENT_LABEL_PRESETS_KEY) return 'filament'
  if (storageKey === LABEL_SHEET_PRESETS_KEY) return 'sheet'
  return null
}

export async function saveLabelPreset(
  storageKey: string,
  preset: { name: string; settings?: unknown; data?: LabelDesignerPresetData; id?: string },
  previousName?: string,
): Promise<boolean> {
  const presetType = presetTypeForStorageKey(storageKey)
  if (!presetType) return false
  if (presetType !== 'sheet' && (
    unsupportedPresetNames.get(presetType)?.has(preset.name)
    || (previousName !== undefined && unsupportedPresetNames.get(presetType)?.has(previousName))
  )) {
    console.warn('Cannot overwrite an unsupported label preset')
    return false
  }
  try {
    await api.put<ApiLabelPreset>(
      `/me/label-presets/${presetType}/item`,
      buildLabelPresetUpsertBody(storageKey, preset, previousName),
    )
    return true
  } catch (error) {
    console.warn('Could not save label presets to the database', error)
    return false
  }
}

export function buildLabelPresetUpsertBody(
  storageKey: string,
  preset: { name: string; settings?: unknown; data?: LabelDesignerPresetData; id?: string },
  previousName?: string,
) {
  const presetType = presetTypeForStorageKey(storageKey)
  if (!presetType) throw new Error('Unknown label preset storage key')
  return {
    name: preset.name,
    previous_name: previousName,
    data: presetType === 'sheet'
      ? { id: preset.id, settings: preset.settings }
      : preset.data ?? { settings: preset.settings },
  }
}

export async function deleteLabelPreset(storageKey: string, name: string): Promise<boolean> {
  const presetType = presetTypeForStorageKey(storageKey)
  if (!presetType) return false
  try {
    await api.delete(`/me/label-presets/${presetType}/item?name=${encodeURIComponent(name)}`)
    return true
  } catch (error) {
    console.warn('Could not delete label preset from the database', error)
    return false
  }
}
