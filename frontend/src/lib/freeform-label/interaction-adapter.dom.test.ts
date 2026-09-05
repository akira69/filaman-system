// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bindLabelInteractions, type InteractFactory } from './interaction-adapter'
import type { LabelDesignElement, LabelDesignV2 } from './types'

type Listener = (event: Record<string, unknown>) => void
type InteractionOptions = { listeners: Record<string, Listener>; edges?: Record<string, boolean> }

function createInteractMock() {
  const bindings = new Map<string, {
    drag?: InteractionOptions
    resize?: InteractionOptions
    unset: ReturnType<typeof vi.fn>
  }>()
  const factory = vi.fn((target: HTMLElement) => {
    const binding = { unset: vi.fn() } as {
      drag?: InteractionOptions
      resize?: InteractionOptions
      unset: ReturnType<typeof vi.fn>
    }
    bindings.set(target.dataset.labelElementId!, binding)
    const interactable = {
      draggable(options: InteractionOptions) {
        binding.drag = options
        return interactable
      },
      resizable(options: InteractionOptions) {
        binding.resize = options
        return interactable
      },
      unset: binding.unset,
    }
    return interactable
  }) as unknown as InteractFactory
  return { factory, bindings }
}

const elements: LabelDesignElement[] = [
  { id: 'text', type: 'text', x: 2, y: 3, w: 20, h: 6, z: 0, template: 'Text', fontFamily: 'Space Grotesk', fontSizeMm: 3, fontWeight: 400, italic: false, underline: false, align: 'left', color: '#000000', wrap: false },
  { id: 'qr', type: 'qr', x: 40, y: 20, w: 15, h: 15, z: 1, mode: 'simple', linkMode: 'spool', urlTemplate: '' },
  { id: 'shape', type: 'shape', x: 10, y: 15, w: 20, h: 5, z: 2, shape: 'rectangle', fill: '#ffffff', stroke: '#000000', strokeWidthMm: 0.2, radiusMm: 0 },
]

function makeDesign(): LabelDesignV2 {
  return {
    version: 2,
    label: { widthMm: 60, heightMm: 40, marginMm: 1, border: false },
    elements: structuredClone(elements),
  }
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="root">
      <div data-label-element-id="text"></div>
      <div data-label-element-id="qr"></div>
      <div data-label-element-id="shape"></div>
    </div>`
  const root = document.querySelector<HTMLElement>('#root')!
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({ width: 600, height: 400, x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400 }),
  })
})

describe('freeform label interaction adapter', () => {
  it('does not load or bind interact.js in read-only mode', async () => {
    const loadInteract = vi.fn()
    const controller = await bindLabelInteractions({
      root: document.querySelector<HTMLElement>('#root')!,
      getDesign: makeDesign,
      editable: false,
      onSelect: vi.fn(),
      onGeometryChange: vi.fn(),
      loadInteract,
    })

    expect(loadInteract).not.toHaveBeenCalled()
    expect(document.querySelector('[data-label-interaction-bound]')).toBeNull()
    controller.destroy()
  })

  it('selects elements and converts drag pixels to clamped millimetres', async () => {
    const { factory, bindings } = createInteractMock()
    const onSelect = vi.fn()
    const onGeometryChange = vi.fn()
    const onGestureStart = vi.fn()
    const onGestureEnd = vi.fn()
    const controller = await bindLabelInteractions({
      root: document.querySelector<HTMLElement>('#root')!,
      getDesign: makeDesign,
      editable: true,
      onSelect,
      onGeometryChange,
      onGestureStart,
      onGestureEnd,
      loadInteract: async () => factory,
    })

    document.querySelector<HTMLElement>('[data-label-element-id="text"]')!.click()
    bindings.get('text')!.drag!.listeners.start({})
    bindings.get('text')!.drag!.listeners.move({ dx: 25, dy: 10 })
    bindings.get('text')!.drag!.listeners.move({ dx: 1000, dy: 1000 })
    bindings.get('text')!.drag!.listeners.end({})

    expect(onSelect).toHaveBeenCalledWith('text')
    expect(onGestureStart).toHaveBeenCalledWith('text')
    expect(onGeometryChange).toHaveBeenNthCalledWith(1, 'text', { x: 4.5, y: 4, w: 20, h: 6 })
    expect(onGeometryChange).toHaveBeenLastCalledWith('text', { x: 40, y: 34, w: 20, h: 6 })
    expect(onGestureEnd).toHaveBeenCalledWith('text')
    controller.destroy()
  })

  it('uses side-only text resize, square QR resize, and free rectangle resize', async () => {
    const { factory, bindings } = createInteractMock()
    const onGeometryChange = vi.fn()
    await bindLabelInteractions({
      root: document.querySelector<HTMLElement>('#root')!,
      getDesign: makeDesign,
      editable: true,
      onSelect: vi.fn(),
      onGeometryChange,
      loadInteract: async () => factory,
    })

    expect(bindings.get('text')!.resize!.edges).toEqual({ left: true, right: true, top: false, bottom: false })
    expect(bindings.get('qr')!.resize!.edges).toEqual({ left: true, right: true, top: true, bottom: true })
    expect(bindings.get('shape')!.resize!.edges).toEqual({ left: true, right: true, top: true, bottom: true })

    bindings.get('text')!.resize!.listeners.move({
      rect: { width: 250, height: 100 },
      deltaRect: { left: -10, top: -20 },
      edges: { left: true },
    })
    expect(onGeometryChange).toHaveBeenLastCalledWith('text', { x: 1, y: 3, w: 25, h: 6 })

    bindings.get('qr')!.resize!.listeners.move({
      rect: { width: 300, height: 250 },
      deltaRect: { left: -150, top: -100 },
      edges: { left: true, top: true },
    })
    expect(onGeometryChange).toHaveBeenLastCalledWith('qr', { x: 25, y: 5, w: 30, h: 30 })

    bindings.get('shape')!.resize!.listeners.move({
      rect: { width: 350, height: 120 },
      deltaRect: { left: 0, top: 0 },
      edges: { right: true, bottom: true },
    })
    expect(onGeometryChange).toHaveBeenLastCalledWith('shape', { x: 10, y: 15, w: 35, h: 12 })
  })

  it('tears down old bindings on refresh and all bindings on destroy', async () => {
    const { factory, bindings } = createInteractMock()
    const controller = await bindLabelInteractions({
      root: document.querySelector<HTMLElement>('#root')!,
      getDesign: makeDesign,
      editable: true,
      onSelect: vi.fn(),
      onGeometryChange: vi.fn(),
      loadInteract: async () => factory,
    })
    const firstUnsets = [...bindings.values()].map(binding => binding.unset)

    controller.refresh()
    expect(firstUnsets.every(unset => unset.mock.calls.length === 1)).toBe(true)
    const refreshedUnsets = [...bindings.values()].map(binding => binding.unset)
    controller.destroy()
    expect(refreshedUnsets.every(unset => unset.mock.calls.length === 1)).toBe(true)
    expect(document.querySelector('[data-label-interaction-bound]')).toBeNull()
  })
})
