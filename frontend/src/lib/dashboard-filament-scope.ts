export type FilamentScope = 'all' | 'active' | 'used'

export interface DashboardFilament {
  id: number
  material_type: string
}

export interface DashboardSpool {
  filament_id: number
  status_id: number
  remaining_weight_g: number | null
}

export interface DashboardSpoolStatus {
  id: number
  key: string
}

export interface FilamentTypeCount {
  material_type: string
  count: number
}

export interface FilamentStat {
  filament_type: string
  spool_count: number
  total_weight_g: number
}

export interface DashboardFilamentScopeData {
  filamentTypes: Record<FilamentScope, FilamentTypeCount[]>
  filamentStats: Record<FilamentScope, FilamentStat[]>
}

function countFilamentTypes(
  filaments: DashboardFilament[],
  includedIds?: ReadonlySet<number>,
): FilamentTypeCount[] {
  const counts = new Map<string, number>()
  for (const filament of filaments) {
    if (includedIds && !includedIds.has(filament.id)) continue
    const materialType = filament.material_type?.trim()
    if (!materialType) continue
    counts.set(materialType, (counts.get(materialType) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([material_type, count]) => ({ material_type, count }))
    .sort((a, b) => b.count - a.count || a.material_type.localeCompare(b.material_type))
}

function addFilamentStat(
  stats: Map<string, FilamentStat>,
  materialType: string,
  remainingWeight: number | null,
): void {
  const current = stats.get(materialType) ?? {
    filament_type: materialType,
    spool_count: 0,
    total_weight_g: 0,
  }
  current.spool_count += 1
  current.total_weight_g += remainingWeight ?? 0
  stats.set(materialType, current)
}

export function buildDashboardFilamentScopeData(
  filaments: DashboardFilament[],
  spools: DashboardSpool[],
  statuses: DashboardSpoolStatus[],
): DashboardFilamentScopeData {
  const archivedStatusIds = new Set(
    statuses.filter((status) => status.key === 'archived').map((status) => status.id),
  )
  const filamentsById = new Map(filaments.map((filament) => [filament.id, filament]))
  const activeFilamentIds = new Set<number>()
  const usedFilamentIds = new Set<number>()
  const availableStats = new Map<string, FilamentStat>()
  const usedStats = new Map<string, FilamentStat>()

  for (const spool of spools) {
    usedFilamentIds.add(spool.filament_id)
    if (archivedStatusIds.has(spool.status_id)) continue

    const materialType = filamentsById.get(spool.filament_id)?.material_type?.trim()
    if (!materialType) continue

    addFilamentStat(usedStats, materialType, spool.remaining_weight_g)
    if (spool.remaining_weight_g !== null && spool.remaining_weight_g > 0) {
      activeFilamentIds.add(spool.filament_id)
      addFilamentStat(availableStats, materialType, spool.remaining_weight_g)
    }
  }

  const activeStats = [...availableStats.values()].sort(
    (a, b) => b.total_weight_g - a.total_weight_g || a.filament_type.localeCompare(b.filament_type),
  )
  const nonArchivedStats = [...usedStats.values()].sort(
    (a, b) => b.spool_count - a.spool_count || a.filament_type.localeCompare(b.filament_type),
  )

  return {
    filamentTypes: {
      all: countFilamentTypes(filaments),
      active: countFilamentTypes(filaments, activeFilamentIds),
      used: countFilamentTypes(filaments, usedFilamentIds),
    },
    filamentStats: {
      all: activeStats,
      active: activeStats,
      used: nonArchivedStats,
    },
  }
}
