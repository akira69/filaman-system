// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultLabelDesign } from './defaults'
import type { InteractFactory } from './interaction-adapter'
import { deleteLabelPreset, saveLabelPreset } from '../label-preset-storage'
import {
  bindFreeformEditorDom,
  createFreeformEditorController,
  getFreeformLabelPresetNames,
  initFreeformLabelDesignerEditor,
  loadFreeformLabelDesign,
  loadFreeformLabelPresetDesign,
  persistFreeformLabelDesign,
  type LabelAssetClient,
} from './editor-controller'

vi.mock('../label-preset-storage', () => ({
  deleteLabelPreset: vi.fn(async () => true),
  saveLabelPreset: vi.fn(async () => true),
}))

vi.mock('./assets', () => ({
  createLabelAssetClient: () => ({
    list: vi.fn(async () => []),
    upload: vi.fn(),
    delete: vi.fn(async () => undefined),
  }),
}))

function makeController(overrides: Parameters<typeof createFreeformEditorController>[0] = {}) {
  const ids = ['added-1', 'copy-1', 'added-2']
  let initialId = 0
  return createFreeformEditorController({
    initialDesign: createDefaultLabelDesign('spool', () => `initial-${++initialId}`),
    createId: () => ids.shift() ?? 'fallback-id',
    ...overrides,
  })
}

function renderDesignerEditorShell() {
  document.body.innerHTML = `
    <div id="freeform-mobile-notice" hidden></div>
    <div id="freeform-canvas-host" tabindex="0"><div class="label-preview"></div></div>
    <button data-designer-action="delete">Delete</button>
    <select id="freeform-preset-list"></select>
    <input id="freeform-preset-name" />
    <button id="freeform-preset-load">Load</button>
    <button id="freeform-preset-save">Save</button>
    <button id="freeform-preset-delete">Delete preset</button>
    <p id="freeform-preset-status"></p>
  `
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  vi.mocked(saveLabelPreset).mockReset().mockResolvedValue(true)
  vi.mocked(deleteLabelPreset).mockReset().mockResolvedValue(true)
})

describe('freeform editor element operations', () => {
  it('adds, selects, duplicates, reorders, and deletes elements', () => {
    const controller = makeController()

    const added = controller.addElement('shape')
    expect(controller.getState().selectedId).toBe(added.id)
    expect(controller.getState().design.elements.at(-1)?.type).toBe('shape')

    const copy = controller.duplicateSelected()
    expect(copy?.id).toBe('copy-1')
    expect(copy?.x).toBeGreaterThan(added.x)

    controller.moveSelected('back')
    expect(controller.getState().design.elements.at(-2)?.id).toBe(copy?.id)
    controller.moveSelected('front')
    expect(controller.getState().design.elements.at(-1)?.id).toBe(copy?.id)

    expect(controller.deleteSelected()).toBe(true)
    expect(controller.getState().design.elements.some(element => element.id === copy?.id)).toBe(false)
  })

  it('updates the selected element, nudges within bounds, and supports undo/redo', () => {
    const onChange = vi.fn()
    const controller = makeController({ onChange })
    const selected = controller.getState().design.elements[0]
    controller.select(selected.id)

    controller.updateSelected({ fontFamily: 'Fraunces', fontSizeMm: 4.5 })
    controller.nudgeSelected(-10_000, -10_000)

    const changed = controller.getSelectedElement()
    expect(changed?.x).toBe(0)
    expect(changed?.y).toBe(0)
    expect(changed?.type === 'text' && changed.fontFamily).toBe('Fraunces')
    expect(onChange).toHaveBeenCalled()

    controller.undo()
    expect(controller.getSelectedElement()?.x).toBe(selected.x)
    controller.redo()
    expect(controller.getSelectedElement()?.x).toBe(0)
  })

  it('updates label geometry and re-bounds existing elements', () => {
    const controller = makeController()

    controller.updateLabel({ widthMm: 30, heightMm: 20, marginMm: 2, border: true })

    const design = controller.getState().design
    expect(design.label).toEqual({ widthMm: 30, heightMm: 20, marginMm: 2, border: true })
    expect(design.elements.every(element => element.x + element.w <= 30 && element.y + element.h <= 20)).toBe(true)
  })
})

describe('freeform editor JSON and field insertion', () => {
  it('applies valid selected-element JSON and isolates an invalid draft', () => {
    const controller = makeController()
    const selected = controller.getState().design.elements[0]
    controller.select(selected.id)

    const valid = JSON.stringify({ ...selected, template: '{filament.name}', color: '#123456' })
    expect(controller.applySelectedJson(valid)).toEqual({ ok: true })
    const applied = controller.getSelectedElement()
    expect(applied?.type === 'text' && applied.template).toBe('{filament.name}')

    expect(controller.applySelectedJson('{')).toEqual({
      ok: false,
      error: 'Element JSON must be valid JSON',
    })
    const retained = controller.getSelectedElement()
    expect(retained?.type === 'text' && retained.template).toBe('{filament.name}')
    expect(controller.getSelectedJson()).toContain('"#123456"')
  })

  it('inserts a modified field at the active caret or creates a text element', () => {
    const controller = makeController()
    const selected = controller.getState().design.elements[0]
    controller.select(selected.id)
    controller.setTemplateSelection(1, 1)

    controller.insertField('{filament.type}', 'bold')
    const text = controller.getSelectedElement()
    expect(text?.type === 'text' && text.template).toContain('**{filament.type}**')

    controller.clearSelection()
    const created = controller.insertField('{filament.name}', 'date')
    expect(created.type).toBe('text')
    expect(created.type === 'text' && created.template).toBe('{filament.name|date}')
  })
})

describe('freeform editor assets and async lifecycle', () => {
  let assets: LabelAssetClient

  beforeEach(() => {
    assets = {
      list: vi.fn(async () => [{
        id: 'asset-1',
        display_name: 'logo.png',
        sha256: 'abc',
        media_type: 'image/png',
        width: 20,
        height: 10,
        byte_size: 100,
        orphaned_at: null,
        created_at: '2026-09-05T00:00:00Z',
        updated_at: '2026-09-05T00:00:00Z',
        content_url: '/api/v1/me/label-assets/asset-1/content',
      }]),
      upload: vi.fn(async () => ({
        id: 'asset-2',
        display_name: 'new.png',
        sha256: 'def',
        media_type: 'image/png',
        width: 40,
        height: 20,
        byte_size: 200,
        orphaned_at: null,
        created_at: '2026-09-05T00:00:00Z',
        updated_at: '2026-09-05T00:00:00Z',
        content_url: '/api/v1/me/label-assets/asset-2/content',
      })),
      delete: vi.fn(async () => undefined),
    }
  })

  it('loads, uploads, selects, and deletes reusable uploaded images', async () => {
    const controller = makeController({ assets })

    await controller.loadAssets()
    expect(controller.getState().assets.map(asset => asset.id)).toEqual(['asset-1'])

    const uploaded = await controller.uploadAsset(new File(['png'], 'new.png', { type: 'image/png' }))
    expect(controller.getState().assets.map(asset => asset.id)).toEqual(['asset-2', 'asset-1'])
    const image = controller.addImage(uploaded.id)
    expect(image.assetId).toBe('asset-2')

    controller.deleteSelected()
    await controller.deleteAsset('asset-2')
    expect(assets.delete).toHaveBeenCalledWith('asset-2')
    expect(controller.getState().assets.map(asset => asset.id)).toEqual(['asset-1'])
  })

  it('ignores stale renders and stops publishing after destroy', async () => {
    const finish: Array<() => void> = []
    const rendered: number[] = []
    const controller = makeController({
      render: (_design, revision) => new Promise<void>(resolve => {
        finish.push(() => {
          rendered.push(revision)
          resolve()
        })
      }),
    })

    const first = controller.requestRender()
    controller.addElement('shape')
    const second = controller.requestRender()
    finish[1]()
    await second
    finish[0]()
    await first

    expect(controller.getState().renderedRevision).toBe(2)
    controller.destroy()
    controller.addElement('shape')
    expect(controller.getState().destroyed).toBe(true)
    expect(rendered).toEqual([2, 1])
  })
})

describe('freeform editor DOM binding', () => {
  it('wires toolbar, inspector JSON, field chips, keyboard, and teardown', async () => {
    document.body.innerHTML = `
      <div id="freeform-designer-workspace" class="is-active">
        <button data-designer-add="shape">Shape</button>
        <button data-designer-action="undo">Undo</button>
        <button data-designer-action="redo">Redo</button>
        <button data-designer-action="duplicate">Duplicate</button>
        <button data-designer-action="delete">Delete</button>
        <div id="freeform-canvas-host" tabindex="0"><div id="label-preview"></div></div>
        <button data-field-modifier="bold" aria-pressed="false">B</button>
        <button data-field-token="{filament.name}">Name</button>
        <h2 id="freeform-inspector-title"></h2>
        <div id="freeform-inspector-empty"></div>
        <div id="freeform-inspector-fields"></div>
        <input data-element-prop="x" />
        <textarea id="freeform-template" data-element-prop="template"></textarea>
        <div data-element-section="text"></div>
        <div data-element-section="image"></div>
        <textarea id="freeform-element-json"></textarea>
        <p id="freeform-json-error"></p>
        <button id="freeform-json-apply">Apply</button>
        <button id="freeform-json-revert">Revert</button>
        <button id="freeform-json-expand">Expand</button>
        <section class="freeform-json-section"></section>
      </div>
    `
    const controller = makeController()
    const binding = bindFreeformEditorDom({
      root: document,
      controller,
      editable: true,
    })

    document.querySelector<HTMLButtonElement>('[data-designer-add="shape"]')!.click()
    expect(controller.getSelectedElement()?.type).toBe('shape')

    document.querySelector<HTMLButtonElement>('[data-field-modifier="bold"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-field-token]')!.click()
    const inserted = controller.getSelectedElement()
    expect(inserted?.type).toBe('text')
    expect(inserted?.type === 'text' && inserted.template).toBe('**{filament.name}**')

    const json = document.querySelector<HTMLTextAreaElement>('#freeform-element-json')!
    json.value = '{'
    document.querySelector<HTMLButtonElement>('#freeform-json-apply')!.click()
    expect(document.querySelector('#freeform-json-error')!.textContent).toContain('valid JSON')

    document.querySelector<HTMLElement>('#freeform-canvas-host')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(controller.getSelectedElement()?.type).not.toBe('text')

    binding.destroy()
    document.querySelector<HTMLButtonElement>('[data-designer-add="shape"]')!.click()
    expect(controller.getState().destroyed).toBe(true)
  })

  it('binds interactions when a batch representative appears after initialization', async () => {
    document.body.innerHTML = '<div id="freeform-canvas-host"></div>'
    const controller = makeController({
      render: async design => {
        const canvas = document.createElement('div')
        canvas.className = 'label-preview'
        for (const element of design.elements) {
          const node = document.createElement('div')
          node.dataset.labelElementId = element.id
          canvas.append(node)
        }
        document.querySelector('#freeform-canvas-host')!.replaceChildren(canvas)
      },
    })
    const interactable: ReturnType<InteractFactory> = {
      draggable: vi.fn(() => interactable),
      resizable: vi.fn(() => interactable),
      unset: vi.fn(),
    }
    const loadInteract = vi.fn(async () => vi.fn(() => interactable))
    const binding = bindFreeformEditorDom({
      root: document,
      controller,
      editable: true,
      loadInteract,
    })

    await binding.refresh()
    const last = controller.getState().design.elements.at(-1)!
    document.querySelector<HTMLElement>(`[data-label-element-id="${last.id}"]`)!
      .click()

    expect(loadInteract).toHaveBeenCalled()
    expect(controller.getState().selectedId).toBe(last.id)
    binding.destroy()
  })

  it('destroys and rebinds interactions when editability changes', async () => {
    document.body.innerHTML = '<div id="freeform-canvas-host"><div class="label-preview"></div></div>'
    const controller = makeController()
    const selectedId = controller.getState().selectedId!
    document.querySelector('.label-preview')!.innerHTML = `<div data-label-element-id="${selectedId}"></div>`
    const interactable: ReturnType<InteractFactory> = {
      draggable: vi.fn(() => interactable),
      resizable: vi.fn(() => interactable),
      unset: vi.fn(),
    }
    const loadInteract = vi.fn(async () => vi.fn(() => interactable))
    const binding = bindFreeformEditorDom({
      root: document,
      controller,
      editable: true,
      loadInteract,
    })
    await binding.refresh()
    await vi.waitFor(() => expect(loadInteract).toHaveBeenCalled())
    const initialBindCount = loadInteract.mock.calls.length

    await binding.setEditable(false)
    expect(interactable.unset).toHaveBeenCalled()

    await binding.setEditable(true)
    expect(loadInteract.mock.calls.length).toBeGreaterThan(initialBindCount)
    binding.destroy()
  })
})

describe('freeform editor responsive lifecycle', () => {
  it('allows editing at 901px and blocks keyboard mutation at 900px', async () => {
    renderDesignerEditorShell()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 901 })
    const editor = await initFreeformLabelDesignerEditor({
      onChange: () => undefined,
      presetsKey: 'responsive-presets',
      settingsKey: 'responsive-working',
    })
    const canvas = document.querySelector<HTMLElement>('#freeform-canvas-host')!

    const wideCount = editor.getDesign().elements.length
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(editor.getDesign().elements).toHaveLength(wideCount - 1)

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    window.dispatchEvent(new Event('resize'))
    const narrowCount = editor.getDesign().elements.length
    expect(document.querySelector<HTMLButtonElement>('[data-designer-action="delete"]')!.disabled).toBe(true)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(editor.getDesign().elements).toHaveLength(narrowCount)
    expect(document.querySelector<HTMLElement>('#freeform-mobile-notice')!.hidden).toBe(false)

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 901 })
    window.dispatchEvent(new Event('resize'))
    expect(document.querySelector<HTMLButtonElement>('[data-designer-action="delete"]')!.disabled).toBe(false)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(editor.getDesign().elements).toHaveLength(narrowCount - 1)
    editor.destroy()
  })
})

describe('freeform editor working storage', () => {
  it('prefers the v2 working design and falls back to a hydrated preset cache', () => {
    const cached = createDefaultLabelDesign('filament', () => `cached-${Math.random()}`)
    localStorage.setItem('preset-cache', JSON.stringify({
      version: 2,
      presets: [{ name: 'Default', data: { version: 2, design: cached } }],
    }))

    expect(loadFreeformLabelDesign({
      settingsKey: 'working',
      presetsKey: 'preset-cache',
      kind: 'filament',
    })).toEqual(cached)

    const working = { ...cached, label: { ...cached.label, widthMm: 72 } }
    persistFreeformLabelDesign('working', working)
    expect(loadFreeformLabelDesign({
      settingsKey: 'working',
      presetsKey: 'preset-cache',
      kind: 'filament',
    }).label.widthMm).toBe(72)
  })

  it('loads a named v2 preset without replacing the active working design', () => {
    const compact = createDefaultLabelDesign('spool', () => `compact-${Math.random()}`)
    const wide = {
      ...compact,
      label: { ...compact.label, widthMm: 90 },
    }
    localStorage.setItem('preset-cache', JSON.stringify({
      version: 2,
      presets: [
        { name: 'Compact', data: { version: 2, design: compact } },
        { name: 'Wide', data: { version: 2, design: wide } },
      ],
    }))
    persistFreeformLabelDesign('working', compact)

    expect(getFreeformLabelPresetNames('preset-cache')).toEqual(['Compact', 'Wide'])
    expect(loadFreeformLabelPresetDesign({
      presetsKey: 'preset-cache',
      presetName: 'Wide',
      kind: 'spool',
    })?.label.widthMm).toBe(90)
    expect(loadFreeformLabelPresetDesign({
      presetsKey: 'preset-cache',
      presetName: 'Missing',
      kind: 'spool',
    })).toBeNull()
    expect(loadFreeformLabelDesign({
      settingsKey: 'working',
      presetsKey: 'preset-cache',
      kind: 'spool',
    }).label.widthMm).toBe(compact.label.widthMm)
  })
})

describe('freeform editor database-owned presets', () => {
  function seedPreset() {
    const design = createDefaultLabelDesign('spool', () => `preset-${Math.random()}`)
    const cache = {
      version: 2,
      presets: [{
        name: 'Existing',
        data: {
          version: 2,
          design,
          legacy_v1: { width: 64, height: 32 },
        },
        settings: { width: 64, height: 32 },
      }],
    }
    localStorage.setItem('database-presets', JSON.stringify(cache))
    return cache
  }

  async function initPresetEditor() {
    renderDesignerEditorShell()
    return initFreeformLabelDesignerEditor({
      onChange: () => undefined,
      presetsKey: 'database-presets',
      settingsKey: 'database-working',
    })
  }

  it('rolls back a failed preset save', async () => {
    const cache = seedPreset()
    vi.mocked(saveLabelPreset).mockResolvedValue(false)
    const editor = await initPresetEditor()
    document.querySelector<HTMLInputElement>('#freeform-preset-name')!.value = 'Phantom'

    document.querySelector<HTMLButtonElement>('#freeform-preset-save')!.click()
    await vi.waitFor(() => {
      expect(document.querySelector('#freeform-preset-status')!.textContent).toContain('failed')
    })

    expect(JSON.parse(localStorage.getItem('database-presets')!)).toEqual(cache)
    expect(getFreeformLabelPresetNames('database-presets')).toEqual(['Existing'])
    expect(saveLabelPreset).toHaveBeenCalledWith(
      'database-presets',
      expect.objectContaining({ name: 'Phantom' }),
    )
    editor.destroy()
  })

  it('rolls back a failed preset deletion', async () => {
    const cache = seedPreset()
    vi.mocked(deleteLabelPreset).mockResolvedValue(false)
    const editor = await initPresetEditor()

    document.querySelector<HTMLButtonElement>('#freeform-preset-delete')!.click()
    await vi.waitFor(() => {
      expect(document.querySelector('#freeform-preset-status')!.textContent).toContain('failed')
    })

    expect(JSON.parse(localStorage.getItem('database-presets')!)).toEqual(cache)
    expect(getFreeformLabelPresetNames('database-presets')).toEqual(['Existing'])
    expect(deleteLabelPreset).toHaveBeenCalledWith('database-presets', 'Existing')
    editor.destroy()
  })

  it('preserves legacy_v1 when a v2 preset is resaved', async () => {
    seedPreset()
    const editor = await initPresetEditor()
    document.querySelector<HTMLInputElement>('#freeform-preset-name')!.value = 'Existing'

    document.querySelector<HTMLButtonElement>('#freeform-preset-save')!.click()
    await vi.waitFor(() => {
      expect(document.querySelector('#freeform-preset-status')!.textContent).toContain('saved')
    })

    const stored = JSON.parse(localStorage.getItem('database-presets')!)
    expect(stored.presets[0].data.legacy_v1).toEqual({ width: 64, height: 32 })
    expect(stored.presets[0].settings).toEqual({ width: 64, height: 32 })
    expect(saveLabelPreset).toHaveBeenCalledWith(
      'database-presets',
      expect.objectContaining({
        data: expect.objectContaining({ legacy_v1: { width: 64, height: 32 } }),
        settings: { width: 64, height: 32 },
      }),
    )
    editor.destroy()
  })
})
