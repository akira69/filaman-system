// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import DesignerWorkspace from '../../components/freeform-label/DesignerWorkspace.astro'
import { bindFreeformEditorDom, createFreeformEditorController } from './editor-controller'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

it('caps canvas clearance to the visible drawer capacity for very long field lists', async () => {
  const container = await AstroContainer.create()
  document.body.innerHTML = await container.renderToString(DesignerWorkspace)
  const content = document.querySelector<HTMLElement>('.freeform-field-dock-content')!
  const area = document.querySelector<HTMLElement>('.freeform-canvas-area')!
  const dock = document.getElementById('freeform-field-dock')!
  const toggle = document.getElementById('freeform-field-dock-toggle')!
  const stage = document.querySelector<HTMLElement>('.freeform-canvas-stage')!
  Object.defineProperty(content, 'offsetHeight', { value: 1200 })
  Object.defineProperty(area, 'clientHeight', { value: 400 })
  Object.defineProperty(toggle, 'offsetHeight', { value: 32 })
  dock.style.setProperty('--freeform-drawer-body-limit', '300px')
  const binding = bindFreeformEditorDom({ controller: createFreeformEditorController() })
  await binding.ready
  try {
    expect(stage.style.getPropertyValue('--freeform-drawer-clearance')).toBe('300px')
  } finally { binding.destroy() }
})

it('keeps a discoverable drawer bar and preserves canvas clearance when collapsed or changing selection', async () => {
  const container = await AstroContainer.create()
  document.body.innerHTML = await container.renderToString(DesignerWorkspace)
  const content = document.querySelector<HTMLElement>('.freeform-field-dock-content')!
  Object.defineProperty(content, 'offsetHeight', { value: 220 })
  const controller = createFreeformEditorController()
  const binding = bindFreeformEditorDom({ controller })
  await binding.ready
  try {
    const dock = document.querySelector<HTMLElement>('#freeform-field-dock')!
    const toggle = document.querySelector<HTMLButtonElement>('#freeform-field-dock-toggle')
    expect(toggle).not.toBeNull()
    const body = document.getElementById(toggle!.getAttribute('aria-controls')!)!
    const stage = document.querySelector<HTMLElement>('.freeform-canvas-stage')!
    expect(toggle!.getAttribute('aria-expanded')).toBe('true')
    expect(body.hasAttribute('inert')).toBe(false)
    expect(stage.style.getPropertyValue('--freeform-drawer-clearance')).toBe('220px')

    toggle!.click()
    binding.sync()
    expect(dock.dataset.open).toBe('false')
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')
    expect(dock.hasAttribute('inert')).toBe(false)
    expect(body.hasAttribute('inert')).toBe(true)
    expect(stage.style.getPropertyValue('--freeform-drawer-clearance')).toBe('220px')

    toggle!.click()
    expect(dock.dataset.open).toBe('true')
    controller.addElement('qr')
    binding.sync()
    expect(dock.dataset.open).toBe('false')
    expect(toggle!.disabled).toBe(true)
    expect(stage.style.getPropertyValue('--freeform-drawer-clearance')).toBe('220px')
    controller.select(controller.getDesign().elements.find(element => element.type === 'text')!.id)
    binding.sync()
    expect(dock.dataset.open).toBe('true')
    await binding.setEditable(false)
    expect(dock.hasAttribute('inert')).toBe(true)
    expect(body.hasAttribute('inert')).toBe(true)
  } finally { binding.destroy() }
})
