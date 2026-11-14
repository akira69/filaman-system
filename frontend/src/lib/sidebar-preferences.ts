export const sidebarStorageKey = 'sidebar-preferences'
export const legacyColorKey = 'sidebar-color-library'
export const expandedStorageKey = 'sidebar-plugins-expanded'

export interface SidebarItemPreference {
  id: string
  shown: boolean
  pinned?: boolean
}

export interface SidebarPreferences {
  navigation: SidebarItemPreference[]
  plugins: SidebarItemPreference[]
  compact: boolean
  hover: boolean
  remember: boolean
  showColorMode: boolean
}

export function defaultSidebarPreferences(): SidebarPreferences {
  return { navigation: [], plugins: [], compact: false, hover: true, remember: false, showColorMode: true }
}

export function readSidebarPreferences(storage: Storage): SidebarPreferences {
  let saved: Partial<SidebarPreferences> | null = null
  try {
    saved = JSON.parse(storage.getItem(sidebarStorageKey) ?? 'null')
  } catch { /* Keep the default layout if storage is invalid. */ }
  const navigation = Array.isArray(saved?.navigation) ? saved.navigation : []
  return {
    navigation,
    plugins: Array.isArray(saved?.plugins) ? saved.plugins : [],
    compact: saved?.compact === true,
    hover: saved?.hover !== false,
    remember: saved?.remember === true,
    showColorMode: saved?.showColorMode !== false,
  }
}

export function arrangeSidebarItems<T extends { id: string }>(
  items: T[], preferences: SidebarItemPreference[],
): (T & SidebarItemPreference)[] {
  const remaining = new Map(items.map(item => [item.id, item]))
  const ordered: (T & SidebarItemPreference)[] = []
  for (const preference of preferences) {
    const item = remaining.get(preference?.id)
    if (!item) continue
    ordered.push({ ...item, shown: preference.shown !== false, pinned: preference.pinned !== false })
    remaining.delete(item.id)
  }
  return ordered.concat([...remaining.values()].map(item => ({ ...item, shown: true, pinned: true })))
}

export function mergeSidebarOrder(saved: SidebarItemPreference[], rows: SidebarItemPreference[]) {
  const available = new Set(rows.map(row => row.id))
  const seen = new Set<string>()
  let next = 0
  const merged: SidebarItemPreference[] = []
  // Fill the existing visible slots in editor order, keeping unavailable items in place.
  for (const row of saved) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(available.has(row.id) ? rows[next++] : row)
  }
  return merged.concat(rows.slice(next))
}
