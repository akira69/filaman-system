// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'

import DesignerSidebar from '../../components/freeform-label/DesignerSidebar.astro'
import DesignerWorkspace from '../../components/freeform-label/DesignerWorkspace.astro'
import PrintSidebar from '../../components/PrintSidebar.astro'
import de from '../../i18n/de.json'
import { createDefaultLabelDesign } from './defaults'
import { readStoredPresets } from './editor-storage'
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
  it('keeps preset deletion accessible as an icon-only button', async () => {
    await renderRealDesignerEditor()
    const button = document.querySelector<HTMLButtonElement>('#freeform-preset-delete')!
    expect(button.getAttribute('aria-label')).toBe('Delete')
    expect(button.title).toBe('Delete')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent?.trim()).toBe('')
    expect(button.hasAttribute('data-i18n')).toBe(false)
    expect(button.dataset.i18nAriaLabel).toBe('common.delete')
    expect(button.dataset.i18nTitle).toBe('common.delete')
  })

  it.each([
    ['artwork', 'drag'], ['selection frame', 'drag'],
    ['selection frame', 'resize'],
  ])('hides the text toolbar during %s %s and restores it at the new position', async (target, gesture) => {
    const preview = await renderRealDesignerEditor()
    Object.defineProperty(preview, 'getBoundingClientRect', { value: () => ({ width: 600 }) })
    Object.defineProperty(preview.closest('.freeform-canvas-region'), 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 }),
    })
    const controller = makeController({ render: design => {
      preview.replaceChildren(...design.elements.map(element => {
        const node = document.createElement('div')
        node.dataset.labelElementId = element.id
        node.dataset.labelElementType = element.type
        node.style.left = `${element.x}mm`
        node.style.top = `${element.y}mm`
        Object.defineProperty(node, 'getBoundingClientRect', { value: () => {
          const left = parseFloat(node.style.left) * 10
          const top = parseFloat(node.style.top) * 10
          return { left, top, right: left + 100, bottom: top + 50, width: 100, height: 50 }
        } })
        return node
      }))
    } })
    const drags = new Map<HTMLElement, Parameters<ReturnType<InteractFactory>['draggable']>[0]>()
    const resizes = new Map<HTMLElement, Parameters<ReturnType<InteractFactory>['resizable']>[0]>()
    const factory: InteractFactory = node => {
      const interactable: ReturnType<InteractFactory> = {
        draggable(options) { drags.set(node, options); return interactable },
        resizable(options) { resizes.set(node, options); return interactable },
        unset() {},
      }
      return interactable
    }
    const binding = bindFreeformEditorDom({ controller, loadInteract: async () => factory })
    await binding.ready
    const text = preview.querySelector<HTMLElement>('[data-label-element-type="text"]')!
    const toolbar = document.querySelector<HTMLElement>('#freeform-text-toolbar')!
    const before = parseFloat(toolbar.style.left)
    const dragNode = target === 'selection frame'
      ? preview.querySelector<HTMLElement>('[data-label-selection-for]')!
      : text
    const listeners = (gesture === 'drag' ? drags : resizes).get(dragNode)!.listeners
    const selected = controller.getSelectedElement()!
    expect(toolbar.hidden).toBe(false)
    listeners.start({})
    expect(toolbar.hidden).toBe(true)
    listeners.move(gesture === 'drag' ? { dx: 40, dy: 10 } : {
      rect: { width: selected.w * 10 - 40, height: selected.h * 10 }, edges: { left: true },
    })
    binding.sync()
    window.dispatchEvent(new Event('resize'))
    document.dispatchEvent(new Event('scroll'))
    expect(toolbar.hidden).toBe(true)
    listeners.end({})
    expect(toolbar.hidden).toBe(false)
    expect(parseFloat(toolbar.style.left)).toBe(before + 40)
    // A breakpoint change can interrupt a gesture before its normal end event.
    listeners.start({})
    await binding.setEditable(false)
    expect(toolbar.hidden).toBe(true)
    await binding.setEditable(true)
    expect(toolbar.hidden).toBe(false)
    binding.destroy()
  })

  it('keeps the selected resize frame active over artwork and removes it when selection ends', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({ render: design => {
      preview.replaceChildren(...design.elements.map(element => {
        const node = document.createElement('div')
        node.dataset.labelElementId = element.id
        node.dataset.labelElementType = element.type
        return node
      }))
    } })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const id = controller.getState().selectedId
    const frame = preview.querySelector<HTMLElement>('[data-label-selection-for]')
    expect(frame).not.toBeNull()
    expect(frame!.dataset.labelSelectionFor).toBe(id)
    frame!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(controller.getState().selectedId).toBe(id)
    expect(preview.querySelector('[data-label-selection-for]')).toBe(frame)
    controller.select(controller.getState().design.elements[1].id)
    binding.sync()
    expect(preview.querySelector<HTMLElement>('[data-label-selection-for]')!.dataset.labelSelectionFor).toBe(controller.getState().selectedId)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(preview.querySelector('[data-label-selection-for]')).toBeNull()
    controller.select(id)
    binding.sync()
    await binding.setEditable(false)
    expect(preview.querySelector('[data-label-selection-for]')).toBeNull()
    binding.destroy()
  })

  it('enters visible text selection by double-clicking its resize frame and restores the frame on Escape', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({ render: design => {
      preview.innerHTML = `<div data-label-element-id="${design.elements[0].id}" data-label-element-type="text">Hello world</div>`
    } })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const frame = preview.querySelector<HTMLElement>('[data-label-selection-for]')
    expect(frame).not.toBeNull()
    frame!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await vi.waitFor(() => expect(preview.querySelector('[data-label-selection-for]')).toBeNull())
    const text = preview.querySelector<HTMLElement>('[data-label-element-type="text"]')!
    expect(text.hasAttribute('data-label-text-editing')).toBe(true)
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(preview.querySelector('[data-label-selection-for]')).not.toBeNull())
    expect(text.hasAttribute('data-label-text-editing')).toBe(false)
    binding.destroy()
  })

  it.each(['circle', 'square', 'rectangle', 'line'] as const)('edits %s line thickness in the inspector with undo and storage preservation', async shape => {
    await renderRealDesignerEditor()
    const controller = makeController()
    controller.addElement('shape', shape)
    const initial = controller.getSelectedElement()!
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const thickness = document.querySelector<HTMLInputElement>('[data-element-prop="strokeWidthMm"]')
    expect(thickness).not.toBeNull()
    thickness!.value = '1.2'
    thickness!.dispatchEvent(new Event('change'))
    expect(controller.getSelectedElement()).toMatchObject({ shape, strokeWidthMm: 1.2 })
    if (shape === 'line') {
      expect(controller.getSelectedElement()).toMatchObject({ h: 1.2, y: initial.y - 0.45 })
    }
    persistFreeformLabelDesign('stroke-working', controller.getState().design)
    expect(loadFreeformLabelDesign({ settingsKey: 'stroke-working', presetsKey: 'stroke-presets', kind: 'spool' }).elements.at(-1)).toMatchObject({ strokeWidthMm: 1.2 })
    controller.undo()
    binding.sync()
    expect(thickness!.value).toBe('0.3')
    await binding.setEditable(false)
    expect(thickness!.disabled).toBe(true)
    binding.destroy()
  })

  it('gives a legacy unoutlined shape a stroke when thickness is increased', () => {
    const controller = makeController()
    controller.addElement('shape')
    controller.updateSelected({ stroke: '', strokeWidthMm: 0, fill: '#000000' })
    controller.updateSelected({ strokeWidthMm: 0.5 })
    expect(controller.getSelectedElement()).toMatchObject({ stroke: '#000000', strokeWidthMm: 0.5 })
  })

  it.each(['circle', 'square'] as const)('resizes both axes of a %s from the Height inspector', async shape => {
    await renderRealDesignerEditor()
    const controller = makeController()
    controller.addElement('shape', shape)
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const height = document.querySelector<HTMLInputElement>('[data-element-prop="h"]')!
    height.value = '20'
    height.dispatchEvent(new Event('change'))
    expect(controller.getSelectedElement()).toMatchObject({ shape, w: 20, h: 20 })
    binding.destroy()
  })

  it('opens Shape without inserting, then inserts the chosen kind and disables the picker in read-only mode', async () => {
    await renderRealDesignerEditor()
    const controller = makeController()
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const trigger = document.querySelector<HTMLButtonElement>('[data-shape-menu-trigger]')!
    const menu = document.querySelector<HTMLElement>('[data-shape-menu]')!
    const before = controller.getState().design.elements.length
    trigger.click()
    expect(menu.hidden).toBe(false)
    expect(controller.getState().design.elements).toHaveLength(before)
    document.querySelector<HTMLButtonElement>('[data-designer-shape="circle"]')!.click()
    expect(controller.getSelectedElement()).toMatchObject({ type: 'shape', shape: 'circle' })
    expect(menu.hidden).toBe(true)
    controller.undo()
    expect(controller.getState().design.elements).toHaveLength(before)
    await binding.setEditable(false)
    expect(trigger.disabled).toBe(true)
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-designer-shape]')).every(button => button.disabled)).toBe(true)
    binding.destroy()
  })

  it.each([
    { shape: 'circle', w: 15, h: 15 },
    { shape: 'square', w: 15, h: 15 },
    { shape: 'rectangle', w: 20, h: 10 },
    { shape: 'line', w: 25, h: 0.3 },
  ] as const)('inserts a $shape in one undo step and preserves it in working storage', ({ shape, w, h }) => {
    const controller = makeController()
    const initial = controller.getState().design
    const added = controller.addElement('shape', shape)
    expect(added).toMatchObject({ type: 'shape', shape, w, h })
    expect(controller.getState().selectedId).toBe(added.id)
    persistFreeformLabelDesign('shape-working', controller.getState().design)
    expect(loadFreeformLabelDesign({ settingsKey: 'shape-working', presetsKey: 'shape-presets', kind: 'spool' }).elements.at(-1)).toEqual(added)
    controller.undo()
    expect(controller.getState().design).toEqual(initial)
    controller.redo()
    expect(controller.getState().design.elements.at(-1)).toEqual(added)
  })

  it('clears element and text selection on blank canvas or outside clicks, but preserves editing controls', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({ render: design => {
      preview.innerHTML = `<div data-label-element-id="${design.elements[0].id}" data-label-element-type="text">Hello world</div>`
    } })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const node = preview.firstElementChild as HTMLElement
    const selectedId = controller.getState().selectedId
    for (const selector of ['#freeform-template', '[data-field-modifier="bold"]', '[data-text-modifier="bold"]', '[data-element-prop="x"]', '[data-designer-action="duplicate"]', '.freeform-zoom-slot']) {
      document.querySelector(selector)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(controller.getState().selectedId).toBe(selectedId)
    }
    for (const blank of [preview, document.querySelector('.freeform-canvas-region')!, document.body]) {
      node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      const range = document.createRange()
      range.selectNodeContents(node)
      document.getSelection()!.addRange(range)
      blank.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(controller.getState().selectedId).toBeNull()
      expect(document.getSelection()!.rangeCount).toBe(0)
      expect(node.classList.contains('is-selected')).toBe(false)
      expect(node.hasAttribute('data-label-text-editing')).toBe(false)
      expect(document.querySelector<HTMLElement>('#freeform-field-dock')!.dataset.open).toBe('false')
    }
    binding.destroy()
  })

  it('formats the whole box after Escape clears a previous text highlight', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({ render: design => {
      preview.innerHTML = `<div data-label-element-id="${design.elements[0].id}" data-label-element-type="text">Hello world</div>`
    } })
    controller.updateSelected({ template: 'Hello world' })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    preview.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    controller.setTemplateSelection(0, 5)
    document.querySelector<HTMLButtonElement>('[data-text-modifier="underline"]')!.click()
    await vi.waitFor(() => expect(controller.getSelectedElement()).toMatchObject({ template: '__Hello__ world' }))
    preview.firstElementChild!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.querySelector<HTMLButtonElement>('[data-text-modifier="italic"]')!.click()
    await vi.waitFor(() => expect(controller.getSelectedElement()).toMatchObject({ template: '*__Hello__ world*' }))
    binding.destroy()
  })

  it('restores dragging when selection moves away from a text-selection element', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({ render: design => {
      preview.replaceChildren(...design.elements.map(element => {
        const node = document.createElement('div')
        node.dataset.labelElementId = element.id
        node.dataset.labelElementType = element.type
        node.textContent = element.type === 'text' ? element.template : element.type
        return node
      }))
    } })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const text = preview.querySelector<HTMLElement>('[data-label-element-type="text"]')!
    text.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(text.hasAttribute('data-label-interaction-bound')).toBe(false)
    preview.querySelector<HTMLElement>('[data-label-element-type="qr"]')!.click()
    await vi.waitFor(() => expect(text.hasAttribute('data-label-interaction-bound')).toBe(true))
    expect(text.hasAttribute('data-label-text-editing')).toBe(false)
    binding.destroy()
  })

  it('formats the whole selected text from its nearby toolbar and can undo', async () => {
    const preview = await renderRealDesignerEditor()
    const controller = makeController({ render: design => {
      preview.innerHTML = `<div data-label-element-id="${design.elements[0].id}" data-label-element-type="text"></div>`
    } })
    controller.updateSelected({ template: 'Example' })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const bold = document.querySelector<HTMLButtonElement>('[data-text-modifier="bold"]')!
    expect(bold).not.toBeNull()
    bold.click()
    await vi.waitFor(() => expect(controller.getSelectedElement()).toMatchObject({ template: '**Example**' }))
    controller.undo()
    expect(controller.getSelectedElement()).toMatchObject({ template: 'Example' })
    binding.destroy()
  })

  it('applies a dock modifier to the highlighted template text', async () => {
    await renderRealDesignerEditor()
    const controller = makeController()
    controller.updateSelected({ template: 'Red and blue' })
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const template = document.querySelector<HTMLTextAreaElement>('#freeform-template')!
    template.focus()
    template.setSelectionRange(8, 12)
    template.dispatchEvent(new Event('select'))
    document.querySelector<HTMLButtonElement>('[data-field-modifier="italic"]')!.click()
    await vi.waitFor(() => expect(controller.getSelectedElement()).toMatchObject({ template: 'Red and *blue*' }))
    binding.destroy()
  })

  it('shows the text dock only for text selection and keeps its template beside the tokens', async () => {
    await renderRealDesignerEditor()
    const controller = makeController()
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const dock = document.querySelector<HTMLElement>('#freeform-field-dock')!
    expect(dock.contains(document.querySelector('#freeform-template'))).toBe(true)
    expect(dock.dataset.open).toBe('true')
    controller.addElement('qr')
    binding.sync()
    expect(dock.dataset.open).toBe('false')
    expect(dock.querySelector('#freeform-field-dock-body')?.hasAttribute('inert')).toBe(true)
    controller.clearSelection()
    binding.sync()
    expect(dock.dataset.open).toBe('false')
    controller.select(controller.getState().design.elements[0].id)
    binding.sync()
    expect(dock.dataset.open).toBe('true')
    expect(dock.hasAttribute('inert')).toBe(false)
    binding.destroy()
  })

  it('edits QR center modes in the inspector and supports undo', async () => {
    await renderRealDesignerEditor()
    const controller = makeController()
    controller.addElement('qr')
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const controls = Array.from(document.querySelectorAll<HTMLInputElement>('[data-element-section="qr"] input[type="radio"][data-element-prop="mode"]'))
    expect(controls).toHaveLength(3)
    for (const mode of ['colorLogo', 'logo', 'simple']) {
      controls.find(control => control.value === mode)!.click()
      expect(controller.getSelectedElement()).toMatchObject({ type: 'qr', mode })
      expect(controls.filter(control => control.checked).map(control => control.value)).toEqual([mode])
    }
    controller.undo()
    binding.sync()
    expect(controls.filter(control => control.checked).map(control => control.value)).toEqual(['logo'])
    await binding.setEditable(false)
    expect(controls.every(control => control.disabled)).toBe(true)
    binding.destroy()
  })

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
    expect(changed?.x).toBe(-33.9)
    expect(changed?.y).toBe(-17.9)
    expect(changed?.type === 'text' && changed.fontFamily).toBe('Fraunces')
    expect(onChange).toHaveBeenCalled()

    controller.undo()
    expect(controller.getSelectedElement()?.x).toBe(selected.x)
    controller.redo()
    expect(controller.getSelectedElement()?.x).toBe(-33.9)
  })

  it('updates label geometry and re-bounds existing elements', () => {
    const controller = makeController()

    controller.updateLabel({ widthMm: 30, heightMm: 20, marginMm: 2, border: true })

    const design = controller.getState().design
    expect(design.label).toEqual({ widthMm: 30, heightMm: 20, marginMm: 2, border: true })
    expect(design.elements.every(element => (
      element.x < 30
      && element.y < 20
      && element.x + element.w > 0
      && element.y + element.h > 0
    ))).toBe(true)
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

  it('keeps a new image unassigned until an existing image is chosen', async () => {
    await renderRealDesignerEditor()
    const controller = makeController({ assets })
    controller.addElement('image')
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    await vi.waitFor(() => expect(controller.getState().assets).toHaveLength(1))
    binding.sync()
    const select = document.querySelector<HTMLSelectElement>('#freeform-image-asset')!
    const remove = document.querySelector<HTMLButtonElement>('#freeform-image-delete')!
    expect(remove.disabled).toBe(true)
    expect(select.value).toBe('')
    expect(select.selectedOptions[0].textContent).toBe('Choose an image')
    select.value = 'asset-1'
    select.dispatchEvent(new Event('change'))
    expect(controller.getSelectedElement()).toMatchObject({ assetId: 'asset-1' })
    expect(remove.disabled).toBe(false)
    await binding.setEditable(false)
    expect(remove.disabled).toBe(true)
    binding.destroy()
  })

  it('opens the file chooser from the upload button and disables it in read-only mode', async () => {
    await renderRealDesignerEditor()
    const controller = makeController({ assets })
    controller.addElement('image')
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const trigger = document.querySelector<HTMLButtonElement>('#freeform-image-upload-trigger')
    expect(trigger).not.toBeNull()
    const input = document.querySelector<HTMLInputElement>('#freeform-image-upload')!
    const chooser = vi.spyOn(input, 'click')
    trigger!.click()
    expect(chooser).toHaveBeenCalledOnce()
    await binding.setEditable(false)
    expect(trigger!.disabled).toBe(true)
    trigger!.click()
    expect(chooser).toHaveBeenCalledOnce()
    binding.destroy()
  })

  it('uploads into the original image box even if selection changes during upload', async () => {
    await renderRealDesignerEditor()
    const uploadResult = deferred<Awaited<ReturnType<LabelAssetClient['upload']>>>()
    const uploadedAsset = await assets.upload(new File(['image'], 'new.png'))
    assets.upload = () => uploadResult.promise
    const controller = makeController({ assets })
    const image = controller.addElement('image')
    const before = controller.getState().design.elements.length
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const upload = document.querySelector<HTMLInputElement>('#freeform-image-upload')!
    Object.defineProperty(upload, 'files', { value: [new File(['image'], 'new.png')] })
    upload.dispatchEvent(new Event('change'))
    controller.select(controller.getState().design.elements[0].id)
    binding.sync()
    uploadResult.resolve(uploadedAsset)
    await vi.waitFor(() => expect(controller.getState().design.elements.find(element => element.id === image.id)).toMatchObject({ assetId: 'asset-2' }))
    expect(controller.getState().design.elements).toHaveLength(before)
    expect(controller.getSelectedElement()?.type).toBe('text')
    controller.undo()
    expect(controller.getState().design.elements.find(element => element.id === image.id)).toMatchObject({ assetId: '' })
    binding.destroy()
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

  it('awaits rendering without publishing design changes and skips destroyed editors', async () => {
    const pending = deferred<void>()
    const changed = vi.fn()
    const render = vi.fn(() => pending.promise)
    const controller = makeController({
      onChange: changed,
      render,
    })
    let finished = false
    const rendering = controller.requestRender().then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    pending.resolve()
    await rendering
    controller.destroy()
    await controller.requestRender()
    expect(render).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('freeform editor DOM binding', () => {
  it('renders dock and canvas text modifiers in the same accessible order', async () => {
    await renderRealDesignerEditor()
    const names = ['bold', 'italic', 'underline', 'caps', 'inverse', 'colorInverse', 'date']
    const labels = ['Bold', 'Italic', 'Underline', 'Uppercase', 'Inverse', 'Filament color inverse', 'Date only']
    const dock = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-field-modifier]'))
    const canvas = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-text-modifier]'))

    expect(dock.map(button => button.dataset.fieldModifier)).toEqual(names)
    expect(canvas.map(button => button.dataset.textModifier)).toEqual(names)
    expect(dock.map(button => button.getAttribute('aria-label'))).toEqual(labels)
    expect(canvas.map(button => button.getAttribute('aria-label'))).toEqual(labels)
    expect(dock.map(button => button.getAttribute('aria-pressed'))).toEqual(names.map(() => 'false'))
    expect(canvas.map(button => button.getAttribute('aria-pressed'))).toEqual(names.map(() => null))
  })

  it('gives every real icon tool a localized tooltip and accessible name', async () => {
    await renderRealDesignerEditor()
    const iconTools = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-designer-add], .freeform-toolbar [data-designer-action], [data-field-modifier]',
    ))
    expect(iconTools.length).toBeGreaterThan(15)
    for (const tool of iconTools) {
      expect(tool.dataset.i18nTitle, tool.outerHTML).toMatch(/^(labelDesigner|common)\./)
      expect(resolveTranslation(de, tool.dataset.i18nAriaLabel ?? '', ''), tool.outerHTML).toBeTruthy()
      expect(resolveTranslation(de, tool.dataset.i18nTitle ?? '', ''), tool.outerHTML).toBeTruthy()
      expect(tool.getAttribute('aria-label'), tool.outerHTML).toBeTruthy()
      expect(tool.getAttribute('title'), tool.outerHTML).toBeTruthy()
    }
    for (const modifier of ['caps', 'inverse', 'colorInverse', 'date']) {
      expect(document.querySelector(`[data-field-modifier="${modifier}"] svg`)).not.toBeNull()
    }
    const toolbarTools = Array.from(document.querySelectorAll<HTMLElement>(
      '.freeform-toolbar [data-designer-add], .freeform-toolbar [data-designer-action], .freeform-toolbar [data-shape-menu-trigger]',
    ))
    const visibleLabels = Array.from(document.querySelectorAll<HTMLElement>('.freeform-toolbar .freeform-tool-label'))
    expect(visibleLabels).toHaveLength(toolbarTools.length)
    for (const label of visibleLabels) {
      expect(label.dataset.i18n).toMatch(/^labelDesigner\.(tool|duplicate)/)
      expect(label.textContent?.trim()).toBeTruthy()
    }
    expect(document.querySelector('[data-field-modifier="bold"]')?.textContent?.trim()).toBe('B')
    expect(document.querySelector('[data-field-modifier="italic"]')?.textContent?.trim()).toBe('I')
    expect(document.querySelector('[data-field-modifier="underline"]')?.textContent?.trim()).toBe('U')
  })

  it('keeps element actions only in the toolbar and disables them without a selection', async () => {
    await renderRealDesignerEditor()
    const controller = makeController()
    const binding = bindFreeformEditorDom({ controller })
    await binding.ready
    const actions = ['duplicate', 'delete', 'forward', 'back'].map(action =>
      document.querySelector<HTMLButtonElement>(`.freeform-toolbar [data-designer-action="${action}"]`)!,
    )
    const selectedId = controller.getSelectedId()!
    expect(actions.every(button => button && !button.disabled)).toBe(true)
    expect(document.querySelectorAll('#freeform-element-inspector [data-designer-action]')).toHaveLength(0)
    expect(actions[0].textContent?.trim()).toBe('Duplicate')
    expect(actions.slice(0, 2).every(button => button.querySelector('svg'))).toBe(true)
    expect(actions[1].title).toContain('Image files stay in the library')

    controller.clearSelection()
    binding.sync()
    expect(actions.every(button => button.disabled && !button.hidden)).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[data-designer-add="text"]')!.disabled).toBe(false)
    controller.select(selectedId)
    binding.sync()
    expect(actions.every(button => !button.disabled)).toBe(true)
    await binding.setEditable(false)
    expect(actions.every(button => button.disabled)).toBe(true)
    binding.destroy()
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

  it.each(['together', 'stale last'] as const)('keeps line controls after overlapping interaction loads resolve %s', async order => {
    renderDesignerEditorShell()
    const controller = makeController()
    const line = controller.addElement('shape', 'line')
    const canvas = document.querySelector<HTMLElement>('.label-preview')!
    canvas.innerHTML = `<div data-label-element-id="${line.id}" data-label-element-type="shape"></div>`
    const firstLoad = deferred<InteractFactory>()
    const secondLoad = deferred<InteractFactory>()
    const factory = (await import('interactjs')).default as unknown as InteractFactory
    const loadInteract = vi.fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)
    const binding = bindFreeformEditorDom({ controller, loadInteract })
    await vi.waitFor(() => expect(loadInteract).toHaveBeenCalledOnce())
    const refresh = binding.refreshInteractions()
    await vi.waitFor(() => expect(loadInteract).toHaveBeenCalledTimes(2))

    if (order === 'together') {
      firstLoad.resolve(factory)
      secondLoad.resolve(factory)
    } else {
      secondLoad.resolve(factory)
      await refresh
      firstLoad.resolve(factory)
    }
    await Promise.all([binding.ready, refresh])
    const node = canvas.querySelector<HTMLElement>('[data-label-element-id]')!
    const state = {
      bound: node.hasAttribute('data-label-interaction-bound'),
      cursor: node.style.cursor,
      endpoints: node.querySelectorAll('[data-label-line-end]').length,
    }
    binding.destroy()

    expect(state).toEqual({ bound: true, cursor: 'move', endpoints: 2 })
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

    document.querySelector<HTMLButtonElement>('[data-designer-shape="rectangle"]')!.click()
    expect(document.querySelector('#freeform-selection-summary')?.textContent).toMatch(/^Formelement · [\d.]+ × [\d.]+ mm$/)
    editor.destroy()
  })

  it.each(['height', 'border'])('preserves untouched label precision when changing %s', async changed => {
    renderDesignerEditorShell()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    const design = createDefaultLabelDesign('spool')
    design.label = { widthMm: 63.456, heightMm: 40.123, marginMm: 1.234, border: false }
    persistFreeformLabelDesign('sidebar-precision', design)
    const editor = await initFreeformLabelDesignerEditor({
      settingsKey: 'sidebar-precision', presetsKey: 'sidebar-precision-presets',
      onChange: async () => undefined,
    })
    try {
      const control = document.querySelector<HTMLInputElement>(`#freeform-label-${changed}`)!
      if (changed === 'height') control.value = '45.67'
      else control.checked = true
      control.dispatchEvent(new Event('change'))
      expect(editor.getDesign().label).toEqual({
        ...design.label,
        ...(changed === 'height' ? { heightMm: 45.67 } : { border: true }),
      })
    } finally {
      editor.destroy()
    }
  })

  it('shows designer numbers with at most two decimals without changing stored precision', async () => {
    await renderRealDesignerEditor()
    let precisionId = 0
    const design = createDefaultLabelDesign('spool', () => `precision-${++precisionId}`)
    design.label = { widthMm: 63.456, heightMm: 40, marginMm: -0, border: false }
    Object.assign(design.elements[0], {
      x: 23.128999,
      y: 11.871,
      w: 20,
      h: 11.871,
    })
    persistFreeformLabelDesign('precision-working', design)

    const editor = await initFreeformLabelDesignerEditor({
      onChange: async () => undefined,
      presetsKey: 'precision-presets',
      settingsKey: 'precision-working',
    })

    document.querySelector<HTMLButtonElement>('[data-designer-action="forward"]')!.click()
    await vi.waitFor(() => expect(document.querySelector('#freeform-selection-summary')?.textContent).toBe('Text element · 20 × 11.87 mm'))
    expect(document.querySelector<HTMLInputElement>('[data-element-prop="x"]')!.value).toBe('23.13')
    expect(document.querySelector<HTMLInputElement>('[data-element-prop="y"]')!.value).toBe('11.87')
    expect(document.querySelector<HTMLInputElement>('[data-element-prop="w"]')!.value).toBe('20')
    expect(document.querySelector<HTMLInputElement>('#freeform-label-width')!.value).toBe('63.46')
    expect(document.querySelector<HTMLInputElement>('#freeform-label-height')!.value).toBe('40')
    expect(document.querySelector<HTMLInputElement>('#freeform-label-margin')!.value).toBe('0')

    const selected = editor.getDesign().elements.find(element => element.id === 'precision-1')!
    expect(selected).toMatchObject({ x: 23.128999, y: 11.871, w: 20, h: 11.871 })
    expect(JSON.parse(document.querySelector<HTMLTextAreaElement>('#freeform-element-json')!.value)).toMatchObject({
      x: 23.128999,
      y: 11.871,
      w: 20,
      h: 11.871,
    })
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
    const observedContainer = workspace.parentElement ?? workspace
    class ResizeObserverStub {
      private target?: Element
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.target = target
        if (target !== observedContainer) return
        notifyResize = () => this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
        notifyResize()
      }
      unobserve() {}
      disconnect() { if (this.target === observedContainer) disconnectSpy() }
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
      expect(document.getElementById(id)).toHaveProperty('disabled', id === 'freeform-preset-delete')
    }
    width.value = String(initial.widthMm + 10)
    width.dispatchEvent(new Event('change'))
    expect(editor.getDesign().label.widthMm).toBe(initial.widthMm + 10)
    editor.destroy()
  })
})

describe('freeform editor working storage', () => {
  it.each(['spool', 'filament'] as const)('loads bundled standards for %s on a fresh installation without storing account presets', async entityType => {
    renderDesignerEditorShell()
    const editor = await initFreeformLabelDesignerEditor({
      settingsKey: 'standard-working', presetsKey: 'standard-presets',
      entityType, onChange: async () => {},
    })
    const select = document.querySelector<HTMLSelectElement>('#freeform-preset-list')!
    const standards = Array.from(select.options).filter(option => option.value.startsWith('builtin:'))
    expect(standards).toHaveLength(8)
    expect(getFreeformLabelPresetNames('standard-presets')).toContain('Slim (40 × 12 mm)')
    expect(loadFreeformLabelPresetDesign({ presetsKey: 'standard-presets', presetName: 'Slim (40 × 12 mm)', kind: 'filament' })?.label).toMatchObject({ widthMm: 40, heightMm: 12 })
    for (const option of standards) {
      select.value = option.value
      select.dispatchEvent(new Event('change'))
      expect(document.querySelector<HTMLButtonElement>('#freeform-preset-delete')!.disabled).toBe(true)
      document.querySelector<HTMLButtonElement>('#freeform-preset-load')!.click()
      const design = editor.getDesign()
      expect(design.elements.some(element => element.type === 'qr' && element.linkMode === 'spool')).toBe(true)
      expect(design.elements.some(element => element.type === 'text' && element.template.includes('{filament.type}'))).toBe(true)
      document.querySelector<HTMLButtonElement>('#freeform-preset-delete')!.click()
      expect(select.options.length).toBe(8)
      expect(localStorage.getItem('standard-presets')).toBeNull()
    }
    const originalWidth = editor.getDesign().label.widthMm
    const width = document.querySelector<HTMLInputElement>('#freeform-label-width')!
    width.value = '75'
    width.dispatchEvent(new Event('change'))
    document.querySelector<HTMLButtonElement>('#freeform-preset-load')!.click()
    expect(editor.getDesign().label.widthMm).toBe(originalWidth)
    editor.destroy()
  })

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

    expect(readStoredPresets('preset-cache').map(preset => preset.name)).toEqual(['Compact', 'Wide'])
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
    expect(readStoredPresets('database-presets').map(preset => preset.name)).toEqual(['Existing'])
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
    expect(readStoredPresets('database-presets').map(preset => preset.name)).toEqual(['Existing'])
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

    expect(readStoredPresets('serialized-save-presets').map(preset => preset.name)).toEqual(['Later'])
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
    expect(readStoredPresets('database-presets').map(preset => preset.name)).toEqual(['Existing', 'Newer'])
    editor.destroy()
  })
})
