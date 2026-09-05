// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'

import DesignerSidebar from '../../components/freeform-label/DesignerSidebar.astro'
import DesignerWorkspace from '../../components/freeform-label/DesignerWorkspace.astro'
import PrintSidebar from '../../components/PrintSidebar.astro'
import de from '../../i18n/de.json'
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

function resolveTranslation(catalog: object, key: string, fallback: string) {
  const value = key.split('.').reduce<unknown>((node, part) => (
    node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  ), catalog)
  return typeof value === 'string' ? value : fallback
}

async function renderRealDesignerEditor() {
  const container = await AstroContainer.create()
  document.body.innerHTML = [
    await container.renderToString(DesignerSidebar),
    await container.renderToString(DesignerWorkspace),
  ].join('')
  const preview = document.createElement('div')
  preview.className = 'label-preview'
  document.querySelector('#freeform-canvas-host')!.append(preview)
  return preview
}

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
    <input id="freeform-label-width" type="number" />
    <input id="freeform-label-height" type="number" />
    <input id="freeform-label-margin" type="number" />
    <input id="freeform-label-border" type="checkbox" />
  `
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.unstubAllGlobals()
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

  it.each([
    ['bold', '**{filament.name}**'],
    ['italic', '*{filament.name}*'],
    ['underline', '__{filament.name}__'],
    ['inverse', '=={filament.name}=='],
    ['colorInverse', '@@{filament.name}@@'],
    ['caps', '^^{filament.name}^^'],
    ['date', '{filament.name|date}'],
  ] as const)('preserves the legacy %s field modifier syntax', (modifier, expected) => {
    const controller = makeController()
    controller.clearSelection()

    const created = controller.insertField('{filament.name}', modifier)

    expect(created.type === 'text' && created.template).toBe(expected)
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

  it('uses a localized image error only when the server provides no message', async () => {
    assets.list = vi.fn(async () => { throw new Error('') })
    const controller = makeController({
      assets,
      translate: (key, fallback) => key || fallback,
    })

    await expect(controller.loadAssets()).rejects.toThrow()
    expect(controller.getState().assetError).toBe('labelDesigner.imageLoadFailed')
  })

  it('ignores stale renders and stops publishing after destroy', async () => {
    const finish: Array<() => void> = []
    const rendered: number[] = []
    const controller = makeController({
      translate: (key, fallback) => resolveTranslation(de, key, fallback),
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
  it('gives every real icon tool a localized tooltip and accessible name', async () => {
    await renderRealDesignerEditor()
    const iconTools = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-designer-add], .freeform-toolbar [data-designer-action], [data-field-modifier]',
    ))
    expect(iconTools.length).toBeGreaterThan(15)
    for (const tool of iconTools) {
      expect(tool.dataset.i18nTitle, tool.outerHTML).toMatch(/^(labelDesigner|common)\./)
      expect(tool.dataset.i18nAriaLabel, tool.outerHTML).toBe(tool.dataset.i18nTitle)
      expect(tool.getAttribute('aria-label'), tool.outerHTML).toBeTruthy()
      expect(tool.getAttribute('title'), tool.outerHTML).toBeTruthy()
    }
    for (const modifier of ['caps', 'inverse', 'colorInverse', 'date']) {
      expect(document.querySelector(`[data-field-modifier="${modifier}"] svg`)).not.toBeNull()
    }
    const toolbarTools = Array.from(document.querySelectorAll<HTMLElement>(
      '.freeform-toolbar [data-designer-add], .freeform-toolbar [data-designer-action]',
    ))
    const visibleLabels = Array.from(document.querySelectorAll<HTMLElement>('.freeform-toolbar .freeform-tool-label'))
    expect(visibleLabels).toHaveLength(toolbarTools.length)
    for (const label of visibleLabels) {
      expect(label.dataset.i18n).toMatch(/^labelDesigner\.tool/)
      expect(label.textContent?.trim()).toBeTruthy()
    }
    expect(document.querySelector('[data-field-modifier="bold"]')?.textContent?.trim()).toBe('B')
    expect(document.querySelector('[data-field-modifier="italic"]')?.textContent?.trim()).toBe('I')
    expect(document.querySelector('[data-field-modifier="underline"]')?.textContent?.trim()).toBe('U')
  })

  it('selects real rendered elements from the keyboard and restores focus after mutations', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({
      render: design => {
        preview.replaceChildren(...design.elements.map(element => {
          const node = document.createElement('div')
          node.dataset.labelElementId = element.id
          node.dataset.labelElementType = element.type
          return node
        }))
      },
    })
    const binding = bindFreeformEditorDom({
      root: document,
      controller,
      editable: true,
      translate: (key, fallback) => resolveTranslation(de, key, fallback),
    })
    await binding.refresh()

    let elements = Array.from(preview.querySelectorAll<HTMLElement>('[data-label-element-id]'))
    expect(elements[0].tabIndex).toBe(0)
    expect(elements[0].getAttribute('role')).toBe('button')
    expect(elements[0].getAttribute('aria-label')).toBe('Textelement')
    expect(document.querySelector('#freeform-inspector-title')?.textContent).toBe('Textelement')

    elements[1].focus()
    expect(controller.getState().selectedId).toBe(elements[1].dataset.labelElementId)
    controller.select(elements[0].dataset.labelElementId!)
    elements[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(controller.getState().selectedId).toBe(elements[1].dataset.labelElementId)
    controller.select(elements[0].dataset.labelElementId!)
    elements[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(controller.getState().selectedId).toBe(elements[1].dataset.labelElementId)

    const beforeNudge = controller.getSelectedElement()!
    elements[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(controller.getSelectedElement()!.x).toBe(beforeNudge.x + 0.1)
    await vi.waitFor(() => expect((document.activeElement as HTMLElement).dataset.labelElementId).toBe(elements[1].dataset.labelElementId))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }))
    expect(controller.getSelectedElement()!.y).toBe(beforeNudge.y + 1)
    await vi.waitFor(() => expect((document.activeElement as HTMLElement).dataset.labelElementId).toBe(elements[1].dataset.labelElementId))

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => {
      elements = Array.from(preview.querySelectorAll<HTMLElement>('[data-label-element-id]'))
      expect(elements).toHaveLength(5)
      expect((document.activeElement as HTMLElement).dataset.labelElementId).toBe('added-1')
    })

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('#freeform-canvas-host')))

    const count = controller.getState().design.elements.length
    const input = document.createElement('input')
    preview.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(controller.getState().design.elements).toHaveLength(count)
    binding.destroy()
  })

  it('associates localized JSON errors and keeps expansion state accessible', async () => {
    await renderRealDesignerEditor()
    const controller = makeController({
      translate: (key, fallback) => resolveTranslation(de, key, fallback),
    })
    const binding = bindFreeformEditorDom({
      root: document,
      controller,
      editable: true,
      translate: (key, fallback) => resolveTranslation(de, key, fallback),
    })
    const before = controller.getSelectedElement()
    const json = document.querySelector<HTMLTextAreaElement>('#freeform-element-json')!
    const error = document.querySelector<HTMLElement>('#freeform-json-error')!
    const expand = document.querySelector<HTMLButtonElement>('#freeform-json-expand')!

    expect(document.querySelector<HTMLLabelElement>('label[for="freeform-element-json"]')).not.toBeNull()
    expect(json.getAttribute('aria-describedby')).toBe('freeform-json-error')
    json.value = '{'
    document.querySelector<HTMLButtonElement>('#freeform-json-apply')!.click()
    expect(json.getAttribute('aria-invalid')).toBe('true')
    expect(error.textContent).toBe('Element-JSON muss gültiges JSON sein')
    expect(controller.getSelectedElement()).toEqual(before)

    json.value = JSON.stringify({ ...before, template: 'Gültig' })
    document.querySelector<HTMLButtonElement>('#freeform-json-apply')!.click()
    expect(json.getAttribute('aria-invalid')).toBeNull()
    expect(error.textContent).toBe('')
    expect(controller.getSelectedElement()).toMatchObject({ template: 'Gültig' })

    json.value = '{'
    document.querySelector<HTMLButtonElement>('#freeform-json-apply')!.click()
    document.querySelector<HTMLButtonElement>('#freeform-json-revert')!.click()
    expect(json.getAttribute('aria-invalid')).toBeNull()
    expect(error.textContent).toBe('')

    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expand.focus()
    expand.click()
    expect(expand.getAttribute('aria-expanded')).toBe('true')
    expect(expand.textContent).toBe('Einklappen')
    expect(document.activeElement).toBe(expand)
    expand.click()
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(expand.textContent).toBe('Erweitern')
    binding.destroy()
  })

  it('implements roving keyboard navigation for real field tabs', async () => {
    await renderRealDesignerEditor()
    const controller = makeController()
    const binding = bindFreeformEditorDom({ root: document, controller, editable: true })
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-field-group-tab]'))
    const panels = Array.from(document.querySelectorAll<HTMLElement>('#freeform-field-dock [role="tabpanel"]'))

    expect(document.querySelector('.freeform-field-groups')?.classList.contains('freeform-field-panel-frame')).toBe(true)
    expect(panels).toHaveLength(tabs.length)
    expect(document.querySelectorAll('.freeform-token-chip')).toHaveLength(10)
    tabs.forEach((tab, index) => expect(tab.getAttribute('aria-controls')).toBe(panels[index].id))

    tabs[0].focus()
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(document.activeElement).toBe(tabs[2])
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
    expect(document.querySelector<HTMLElement>('#freeform-field-panel-extra')!.hidden).toBe(false)
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.activeElement).toBe(tabs[0])
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(tabs[2])
    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, -1, 0])
    binding.destroy()
  })

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

    await binding.refreshInteractions()
    expect(interactable.unset).toHaveBeenCalled()

    await binding.setEditable(false)
    expect(interactable.unset).toHaveBeenCalled()

    await binding.setEditable(true)
    expect(loadInteract.mock.calls.length).toBeGreaterThan(initialBindCount)
    binding.destroy()
  })
})

describe('freeform editor responsive lifecycle', () => {
  it('keeps the single-page designer sidebar compact enough for the preview workspace', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(PrintSidebar, {
      props: { backLabel: 'Zurück' },
    })
    const sidebar = document.querySelector<HTMLElement>('.print-sidebar')!

    expect(sidebar.style.getPropertyValue('--designer-sidebar-width')).toBe('360px')
  })

  it('waits for a late persisted-design render before resolving with bound interactions', async () => {
    renderDesignerEditorShell()
    const initialDesign = createDefaultLabelDesign('spool', () => 'late-persisted-element')
    persistFreeformLabelDesign('late-persisted-working', initialDesign)
    const renderStarted = deferred<void>()
    const finishRender = deferred<void>()
    const interactable: ReturnType<InteractFactory> = {
      draggable: vi.fn(() => interactable),
      resizable: vi.fn(() => interactable),
      unset: vi.fn(),
    }
    const editorPromise = initFreeformLabelDesignerEditor({
      onChange: async () => {
        renderStarted.resolve()
        await finishRender.promise
        const preview = document.createElement('div')
        preview.className = 'label-preview'
        for (const element of initialDesign.elements) {
          const node = document.createElement('div')
          node.dataset.labelElementId = element.id
          node.dataset.labelElementType = element.type
          preview.append(node)
        }
        document.querySelector('#freeform-canvas-host')!.replaceChildren(preview)
      },
      presetsKey: 'late-persisted-presets',
      settingsKey: 'late-persisted-working',
      loadInteract: async () => vi.fn(() => interactable),
    })

    await renderStarted.promise
    const initializationState = await Promise.race([
      editorPromise.then(() => 'resolved'),
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 0)),
    ])
    finishRender.resolve()
    const editor = await editorPromise
    await vi.waitFor(() => {
      expect(document.querySelector('[data-label-interaction-bound]')).not.toBeNull()
    })
    const rendered = document.querySelector<HTMLElement>('[data-label-element-id]')!
    const interactionState = {
      bound: rendered.hasAttribute('data-label-interaction-bound'),
      cursor: rendered.style.cursor,
    }
    editor.destroy()

    expect(initializationState).toBe('pending')
    expect(interactionState).toEqual({ bound: true, cursor: 'move' })
  })

  it('localizes the selected element name in the live selection summary', async () => {
    await renderRealDesignerEditor()
    const workspace = document.querySelector<HTMLElement>('#freeform-designer-workspace')!
    Object.defineProperty(workspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 901 }),
    })
    class ResizeObserverStub {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 901 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const interactable: ReturnType<InteractFactory> = {
      draggable: vi.fn(() => interactable),
      resizable: vi.fn(() => interactable),
      unset: vi.fn(),
    }
    const editor = await initFreeformLabelDesignerEditor({
      onChange: async () => undefined,
      presetsKey: 'localized-summary-presets',
      settingsKey: 'localized-summary-working',
      translate: (key, fallback) => resolveTranslation(de, key, fallback),
      loadInteract: async () => vi.fn(() => interactable),
    })

    document.querySelector<HTMLButtonElement>('[data-designer-add="shape"]')!.click()
    expect(document.querySelector('#freeform-selection-summary')?.textContent).toMatch(/^Formelement · [\d.]+ × [\d.]+ mm$/)
    editor.destroy()
  })

  it('uses observed workspace width at 900/901 and disconnects without leaking interaction bindings', async () => {
    const preview = await renderRealDesignerEditor()
    const workspace = document.querySelector<HTMLElement>('#freeform-designer-workspace')!
    let width = 900
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 901 })
    Object.defineProperty(workspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width }),
    })
    let notifyResize!: () => void
    const disconnectSpy = vi.fn()
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      observe() { notifyResize() }
      unobserve() {}
      disconnect = disconnectSpy
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const interactable: ReturnType<InteractFactory> = {
      draggable: vi.fn(() => interactable),
      resizable: vi.fn(() => interactable),
      unset: vi.fn(),
    }
    const loadInteract = vi.fn(async () => vi.fn(() => interactable))
    const editor = await initFreeformLabelDesignerEditor({
      onChange: async () => undefined,
      presetsKey: 'container-responsive-presets',
      settingsKey: 'container-responsive-working',
      loadInteract,
    })
    const element = document.createElement('div')
    element.dataset.labelElementId = editor.getDesign().elements[0].id
    element.dataset.labelElementType = editor.getDesign().elements[0].type
    preview.append(element)

    expect(workspace.dataset.editorEditable).toBe('false')
    expect(document.querySelector<HTMLElement>('#freeform-mobile-notice')!.hidden).toBe(false)
    for (const selector of ['.freeform-toolbar', '#freeform-element-inspector', '#freeform-field-dock']) {
      expect(document.querySelector(selector)?.hasAttribute('inert')).toBe(true)
    }
    expect(loadInteract).not.toHaveBeenCalled()

    width = 901
    notifyResize()
    await vi.waitFor(() => expect(loadInteract).toHaveBeenCalledOnce())
    expect(workspace.dataset.editorEditable).toBe('true')
    expect(document.querySelector('.freeform-toolbar')?.hasAttribute('inert')).toBe(false)
    expect(element.tabIndex).toBe(0)

    width = 371
    notifyResize()
    await vi.waitFor(() => expect(workspace.dataset.editorEditable).toBe('false'))
    expect(window.innerWidth).toBe(901)
    expect(element.hasAttribute('tabindex')).toBe(false)
    expect(element.classList.contains('is-selected')).toBe(false)

    width = 901
    notifyResize()
    await vi.waitFor(() => expect(workspace.dataset.editorEditable).toBe('true'))

    width = 900
    notifyResize()
    await vi.waitFor(() => expect(interactable.unset).toHaveBeenCalled())
    const callsBeforeDestroy = loadInteract.mock.calls.length
    editor.destroy()
    expect(disconnectSpy).toHaveBeenCalledOnce()
    width = 901
    notifyResize()
    await Promise.resolve()
    expect(loadInteract).toHaveBeenCalledTimes(callsBeforeDestroy)
  })

  it('allows editing at 901px and blocks keyboard mutation at 900px', async () => {
    renderDesignerEditorShell()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 901 })
    const editor = await initFreeformLabelDesignerEditor({
      onChange: async () => undefined,
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

  it('blocks every sidebar mutation at 900px and restores geometry editing at 901px', async () => {
    renderDesignerEditorShell()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 901 })
    const editor = await initFreeformLabelDesignerEditor({
      onChange: async () => undefined,
      presetsKey: 'responsive-sidebar-presets',
      settingsKey: 'responsive-sidebar-working',
    })
    const initial = editor.getDesign().label
    const width = document.querySelector<HTMLInputElement>('#freeform-label-width')!
    const sidebarMutationControlIds = [
      'freeform-label-width',
      'freeform-label-height',
      'freeform-label-margin',
      'freeform-label-border',
      'freeform-preset-name',
      'freeform-preset-load',
      'freeform-preset-save',
      'freeform-preset-delete',
    ]

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    window.dispatchEvent(new Event('resize'))

    for (const id of sidebarMutationControlIds) {
      expect(document.getElementById(id)).toHaveProperty('disabled', true)
    }
    width.value = String(initial.widthMm + 10)
    width.dispatchEvent(new Event('change'))
    expect(editor.getDesign().label).toEqual(initial)
    expect(width.value).toBe(String(initial.widthMm))

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 901 })
    window.dispatchEvent(new Event('resize'))
    for (const id of sidebarMutationControlIds) {
      expect(document.getElementById(id)).toHaveProperty('disabled', false)
    }
    width.value = String(initial.widthMm + 10)
    width.dispatchEvent(new Event('change'))
    expect(editor.getDesign().label.widthMm).toBe(initial.widthMm + 10)
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
      onChange: async () => undefined,
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

  it('serializes overlapping saves so an older rejection cannot erase a later success', async () => {
    renderDesignerEditorShell()
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    vi.mocked(saveLabelPreset)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const editor = await initFreeformLabelDesignerEditor({
      onChange: async () => undefined,
      presetsKey: 'serialized-save-presets',
      settingsKey: 'serialized-save-working',
    })
    const name = document.querySelector<HTMLInputElement>('#freeform-preset-name')!
    const save = document.querySelector<HTMLButtonElement>('#freeform-preset-save')!

    name.value = 'Older'
    save.dispatchEvent(new MouseEvent('click'))
    name.value = 'Later'
    // Exercise the queue's defense against a programmatic/re-entrant event.
    save.disabled = false
    save.dispatchEvent(new MouseEvent('click'))

    await vi.waitFor(() => expect(saveLabelPreset).toHaveBeenCalledTimes(1))
    expect(save.disabled).toBe(true)
    first.reject(new Error('older request failed'))
    await vi.waitFor(() => expect(saveLabelPreset).toHaveBeenCalledTimes(2))
    second.resolve(true)
    await vi.waitFor(() => expect(save.disabled).toBe(false))

    expect(getFreeformLabelPresetNames('serialized-save-presets')).toEqual(['Later'])
    editor.destroy()
  })

  it('serializes an overlapping save and delete and rolls back against the latest cache', async () => {
    seedPreset()
    const saveResult = deferred<boolean>()
    const deleteResult = deferred<boolean>()
    vi.mocked(saveLabelPreset).mockImplementationOnce(() => saveResult.promise)
    vi.mocked(deleteLabelPreset).mockImplementationOnce(() => deleteResult.promise)
    const editor = await initPresetEditor()
    const name = document.querySelector<HTMLInputElement>('#freeform-preset-name')!
    const save = document.querySelector<HTMLButtonElement>('#freeform-preset-save')!
    const remove = document.querySelector<HTMLButtonElement>('#freeform-preset-delete')!

    name.value = 'Newer'
    save.dispatchEvent(new MouseEvent('click'))
    // Exercise serialization beneath the disabled-control UI guard.
    remove.disabled = false
    remove.dispatchEvent(new MouseEvent('click'))

    await vi.waitFor(() => expect(saveLabelPreset).toHaveBeenCalledTimes(1))
    expect(deleteLabelPreset).not.toHaveBeenCalled()
    expect(save.disabled).toBe(true)
    expect(remove.disabled).toBe(true)
    saveResult.resolve(true)
    await vi.waitFor(() => expect(deleteLabelPreset).toHaveBeenCalledTimes(1))
    deleteResult.resolve(false)
    await vi.waitFor(() => expect(remove.disabled).toBe(false))

    expect(save.disabled).toBe(false)
    expect(getFreeformLabelPresetNames('database-presets')).toEqual(['Existing', 'Newer'])
    editor.destroy()
  })
})
