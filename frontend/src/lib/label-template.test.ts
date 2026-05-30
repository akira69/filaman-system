import { describe, expect, it } from 'vitest'
import { renderTemplateText, type SpoolData } from './label-template'

const spoolData: SpoolData = {
  id: 42,
  'filament.name': 'Matte PLA',
  'filament.material': 'pla',
  'filament.color': 'signal orange',
  'filament.color_hex': 'ff6a00',
  'filament.manufacturer': 'FilaMan',
  'filament.extruder_temp': 215,
  'filament.bed_temp': 60,
  'filament.weight': 1000,
  extra: {
    batch: 'lot-a7',
  },
}

describe('renderTemplateText', () => {
  it('uppercases literal text with the caps modifier', () => {
    expect(renderTemplateText('^^signal orange^^', spoolData)).toBe('SIGNAL ORANGE')
  })

  it('uppercases resolved field values with the caps modifier', () => {
    expect(renderTemplateText('^^{filament.color_hex}^^', spoolData)).toBe('FF6A00')
  })

  it('uppercases resolved extra field values with the caps modifier', () => {
    expect(renderTemplateText('Batch: ^^{extra.batch}^^', spoolData)).toBe('Batch: LOT-A7')
  })

  it('keeps optional blocks hidden when a capped token is missing', () => {
    expect(renderTemplateText('{Hex: ^^{filament.missing}^^}', spoolData)).toBe('')
  })

  it('leaves unmatched caps delimiters literal', () => {
    expect(renderTemplateText('^^{filament.color_hex}', spoolData)).toBe('^^ff6a00')
  })
})
