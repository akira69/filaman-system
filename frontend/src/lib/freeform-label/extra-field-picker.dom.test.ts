// @vitest-environment happy-dom
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FieldDock from '../../components/freeform-label/FieldDock.astro'
import { initFreeformLabelDesignerEditor } from './editor-page'
import type { FreeformLabelDesignerEditorController, FreeformLabelDesignerEditorOptions } from './editor-types'
import { renderTemplateText } from '../label-template'
import { buildSpoolDataFromFlatLabel } from '../label-designer'

vi.mock('./assets', () => ({ createLabelAssetClient: () => ({ list: async () => [] }) }))
let editor: FreeformLabelDesignerEditorController | undefined
beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 }) })
afterEach(() => { editor?.destroy(); editor = undefined; document.body.replaceChildren() })

async function setup(options: Partial<FreeformLabelDesignerEditorOptions> = {}) {
  const container = await AstroContainer.create()
  document.body.innerHTML = await container.renderToString(FieldDock)
  editor = await initFreeformLabelDesignerEditor({
    settingsKey: 'picker-settings', presetsKey: 'picker-presets', onChange: async () => {}, ...options,
  })
  return editor
}
const extraTokens = () => [...document.querySelectorAll<HTMLButtonElement>('#freeform-extra-fields [data-field-token]')]

describe('restored extra-field token picker', () => {
  it('inserts extra-prefixed tokens that resolve the supplied values, including legacy unscoped keys', async () => {
    const editor = await setup({ extraFields: [
      { key: 'filament.certified_at', label: 'Certified', source: 'filament', origin: 'system', value: '2026-09-07' },
      { key: 'favorite', label: 'Favorite', source: 'spool', origin: 'custom', value: 'Yes' },
    ] })
    const chips = extraTokens()
    expect(chips.map(chip => chip.dataset.fieldToken)).toEqual(['{extra.filament.certified_at}', '{extra.favorite}'])
    const data = buildSpoolDataFromFlatLabel({ id: 1, extraFields: [
      { key: 'filament.certified_at', label: 'Certified', value: '2026-09-07' },
      { key: 'favorite', label: 'Favorite', value: 'Yes' },
    ] })
    expect(chips.map(chip => renderTemplateText(chip.dataset.fieldToken!, data))).toEqual(['2026-09-07', 'Yes'])
    chips[0].click()
    expect(editor.getDesign().elements.some(element => element.type === 'text' && element.template.includes('{extra.filament.certified_at}'))).toBe(true)
  })

  it('restores source/origin groups, alphabetical ordering and duplicate removal', async () => {
    await setup({ extraFields: [
      { key: 'spool.z', label: 'Zulu', source: 'spool', origin: 'custom', value: '' },
      { key: 'spool.a', label: 'Alpha', source: 'spool', origin: 'custom', value: '' },
      { key: 'spool.a', label: 'Duplicate', source: 'spool', origin: 'custom', value: '' },
      { key: 'filament.a', label: 'Alpha', source: 'filament', origin: 'custom', value: '' },
    ] })
    expect([...document.querySelectorAll('#freeform-extra-fields .ds-tokens-group-label')].map(node => node.textContent)).toEqual([
      'Filament System Extra Fields', 'Spool System Extra Fields', 'Filament Custom Fields', 'Spool Custom Fields',
    ])
    expect(extraTokens().map(chip => chip.dataset.fieldToken)).toEqual(['{extra.filament.a}', '{extra.spool.a}', '{extra.spool.z}'])
    expect(document.getElementById('freeform-extra-fields')!.textContent).toContain('No Filament System Extra Fields are configured.')
  })

  it('limits long custom groups with Show all / Show fewer without losing their tokens', async () => {
    await setup({ entityType: 'filament', extraFields: Array.from({ length: 13 }, (_, index) => ({
      key: `filament.field${index}`, label: `Field ${String(index).padStart(2, '0')}`, source: 'filament', value: '',
    })) })
    expect(extraTokens()).toHaveLength(12)
    document.querySelector<HTMLButtonElement>('.ds-custom-fields-toggle')!.click()
    expect(extraTokens()).toHaveLength(13)
    expect(extraTokens()[12].dataset.fieldToken).toBe('{extra.filament.field12}')
    document.querySelector<HTMLButtonElement>('.ds-custom-fields-toggle')!.click()
    expect(extraTokens()).toHaveLength(12)
  })

  it('restricts filament batch catalogs to filament system fields, including refreshes', async () => {
    const fields = [
      { key: 'filament.system', label: 'System', source: 'filament', origin: 'system' as const, value: '' },
      { key: 'filament.custom', label: 'Custom', source: 'filament', origin: 'custom' as const, value: '' },
      { key: 'spool.system', label: 'Spool system', source: 'spool', origin: 'system' as const, value: '' },
    ]
    const editor = await setup({ entityType: 'filament', batchMode: true, extraFields: fields })
    expect(extraTokens().map(chip => chip.dataset.fieldToken)).toEqual(['{extra.filament.system}'])
    expect(document.getElementById('freeform-extra-fields')!.textContent).toContain('Per-filament Custom Fields are not enabled for batch printing.')
    editor.refreshExtraFields(fields)
    expect(extraTokens().map(chip => chip.dataset.fieldToken)).toEqual(['{extra.filament.system}'])
  })

  it('hides the Spool tab on filament pages and skips it in keyboard navigation', async () => {
    await setup({ entityType: 'filament' })
    const filament = document.getElementById('freeform-field-tab-filament')!
    const spool = document.getElementById('freeform-field-tab-spool')!
    expect(spool.hidden).toBe(true)
    filament.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.getElementById('freeform-field-tab-extra')!.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('freeform-field-panel-spool')!.hidden).toBe(true)
  })
})
