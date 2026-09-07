// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { bindCanvasTextEditor } from './canvas-text-editor'
import { createDefaultLabelDesign } from './defaults'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

it('keeps the floating toolbar attached during stage movement and out of the drawer without interrupting gesture hiding', () => {
  document.body.innerHTML = '<div class="freeform-canvas-region"><div class="freeform-canvas-stage"><div id="freeform-canvas-host"><div data-label-element-id="text"></div></div></div></div><div id="freeform-field-dock"></div><div id="freeform-text-toolbar"></div>'
  const region = document.querySelector<HTMLElement>('.freeform-canvas-region')!
  const stage = document.querySelector<HTMLElement>('.freeform-canvas-stage')!
  const dock = document.getElementById('freeform-field-dock')!
  const node = document.querySelector<HTMLElement>('[data-label-element-id]')!
  const toolbar = document.getElementById('freeform-text-toolbar')!
  let top = 300
  const listeners = new Set<() => void>()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(target: Element) { if (target === stage) listeners.add(this.callback) }
    disconnect() { listeners.delete(this.callback) }
  })
  Object.defineProperty(region, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 }) })
  let dockTop = 600
  Object.defineProperty(dock, 'getBoundingClientRect', { value: () => ({ left: 0, top: dockTop, right: 1000, bottom: 700, width: 1000, height: 700 - dockTop }) })
  Object.defineProperty(node, 'getBoundingClientRect', { value: () => ({ left: 100, top, right: 300, bottom: top + 100, width: 200, height: 100 }) })
  Object.defineProperty(toolbar, 'offsetHeight', { value: 20 })
  const selected = createDefaultLabelDesign('spool').elements.find(element => element.type === 'text')!
  selected.id = 'text'
  const binding = bindCanvasTextEditor({
    root: document, getSelected: () => selected, getTemplateRange: () => ({ start: 0, end: 0 }),
    resetTemplateRange() {}, isEditable: () => true, select() {}, updateTemplate() {},
    refresh: async () => {}, refreshInteractions: async () => {},
  })
  try {
    binding.sync()
    expect(toolbar.style.top).toBe('272px')
    top = 220
    listeners.forEach(callback => callback())
    expect(toolbar.style.top).toBe('192px')
    binding.setGestureActive(true)
    top = 180
    listeners.forEach(callback => callback())
    expect(toolbar.hidden).toBe(true)
    binding.setGestureActive(false)
    expect(toolbar.style.top).toBe('152px')
    dockTop = 150
    binding.positionToolbar()
    expect(toolbar.hidden).toBe(true)
  } finally { binding.destroy() }
  top = 100
  listeners.forEach(callback => callback())
  expect(toolbar.style.top).toBe('152px')
  expect(toolbar.hidden).toBe(true)
})
