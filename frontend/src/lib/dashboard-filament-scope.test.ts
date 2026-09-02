import { describe, expect, it } from 'vitest'

import { buildDashboardFilamentScopeData } from './dashboard-filament-scope'

const statuses = [
  { id: 1, key: 'new' },
  { id: 2, key: 'archived' },
]

describe('buildDashboardFilamentScopeData', () => {
  it('builds all, active, and ever-used filament type counts', () => {
    const data = buildDashboardFilamentScopeData(
      [
        { id: 1, material_type: 'PLA' },
        { id: 2, material_type: 'PLA' },
        { id: 3, material_type: 'PETG' },
        { id: 4, material_type: 'ABS' },
        { id: 5, material_type: '' },
      ],
      [
        { filament_id: 1, status_id: 1, remaining_weight_g: 250 },
        { filament_id: 1, status_id: 1, remaining_weight_g: 100 },
        { filament_id: 2, status_id: 1, remaining_weight_g: 0 },
        { filament_id: 3, status_id: 2, remaining_weight_g: 500 },
      ],
      statuses,
    )

    expect(data.filamentTypes).toEqual({
      all: [
        { material_type: 'PLA', count: 2 },
        { material_type: 'ABS', count: 1 },
        { material_type: 'PETG', count: 1 },
      ],
      active: [{ material_type: 'PLA', count: 1 }],
      used: [
        { material_type: 'PLA', count: 2 },
        { material_type: 'PETG', count: 1 },
      ],
    })
  })

  it('keeps archived spools out of statistics and includes empty/null active-history rows for used', () => {
    const data = buildDashboardFilamentScopeData(
      [
        { id: 1, material_type: 'PLA' },
        { id: 2, material_type: 'ABS' },
        { id: 3, material_type: 'PETG' },
      ],
      [
        { filament_id: 1, status_id: 1, remaining_weight_g: 250 },
        { filament_id: 1, status_id: 1, remaining_weight_g: 0 },
        { filament_id: 2, status_id: 1, remaining_weight_g: null },
        { filament_id: 3, status_id: 2, remaining_weight_g: 900 },
      ],
      statuses,
    )

    expect(data.filamentStats.all).toEqual([
      { filament_type: 'PLA', spool_count: 1, total_weight_g: 250 },
    ])
    expect(data.filamentStats.all).toBe(data.filamentStats.active)
    expect(data.filamentStats.used).toEqual([
      { filament_type: 'PLA', spool_count: 2, total_weight_g: 250 },
      { filament_type: 'ABS', spool_count: 1, total_weight_g: 0 },
    ])
  })

  it('does not mutate source rows and handles an absent archived status', () => {
    const filaments = [{ id: 1, material_type: ' PLA ' }]
    const spools = [{ filament_id: 1, status_id: 99, remaining_weight_g: 5 }]

    const data = buildDashboardFilamentScopeData(filaments, spools, [])

    expect(filaments[0].material_type).toBe(' PLA ')
    expect(spools[0].remaining_weight_g).toBe(5)
    expect(data.filamentTypes.active).toEqual([{ material_type: 'PLA', count: 1 }])
  })
})