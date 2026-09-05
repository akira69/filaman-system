import type { LabelDesignElement, LabelDesignV2 } from './types'

type InteractionEvent = {
  dx?: number
  dy?: number
  rect?: { width: number; height: number }
  deltaRect?: { left?: number; top?: number }
  edges?: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }
}

interface InteractionOptions {
  listeners: {
    start: (event: InteractionEvent) => void
    move: (event: InteractionEvent) => void
    end: (event: InteractionEvent) => void
  }
  edges?: { left: boolean; right: boolean; top: boolean; bottom: boolean }
  inertia?: boolean
  margin?: number
}

interface Interactable {
  draggable(options: InteractionOptions): Interactable
  resizable(options: InteractionOptions): Interactable
  unset(): void
}

export type InteractFactory = (target: HTMLElement) => Interactable

export interface LabelGeometry {
  x: number
  y: number
  w: number
  h: number
}

export interface BindLabelInteractionsOptions {
  root: HTMLElement
  getDesign: () => LabelDesignV2
  editable: boolean
  onSelect: (elementId: string) => void
  onGeometryChange: (elementId: string, geometry: LabelGeometry) => void
  onGestureStart?: (elementId: string) => void
  onGestureEnd?: (elementId: string) => void
  loadInteract?: () => Promise<InteractFactory>
}

export interface LabelInteractionController {
  refresh(): void
  destroy(): void
}

const roundMm = (value: number) => Math.round(value * 1000) / 1000
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const RESIZE_EDGE_MARGIN_PX = 3
const MINIMUM_MOVE_TARGET_PX = 8
const MINIMUM_RESIZABLE_AXIS_PX = RESIZE_EDGE_MARGIN_PX * 2 + MINIMUM_MOVE_TARGET_PX

function geometryOf(element: LabelDesignElement): LabelGeometry {
  return { x: element.x, y: element.y, w: element.w, h: element.h }
}

async function loadInteractJs(): Promise<InteractFactory> {
  const module = await import('interactjs')
  return module.default as unknown as InteractFactory
}

export async function bindLabelInteractions(
  options: BindLabelInteractionsOptions,
): Promise<LabelInteractionController> {
  if (!options.editable) return { refresh() {}, destroy() {} }

  const interact = await (options.loadInteract ?? loadInteractJs)()
  let interactables: Interactable[] = []
  let destroyed = false
  let geometry = new Map<string, LabelGeometry>()

  const pxPerMm = () => {
    const widthPx = options.root.getBoundingClientRect().width
    const widthMm = options.getDesign().label.widthMm
    return widthPx > 0 && widthMm > 0 ? widthPx / widthMm : 96 / 25.4
  }

  const selectFromEvent = (event: Event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-label-element-id]')
      : null
    if (target?.dataset.labelElementId) options.onSelect(target.dataset.labelElementId)
  }
  options.root.addEventListener('click', selectFromEvent)

  const commitGeometry = (node: HTMLElement, id: string, next: LabelGeometry) => {
    const rounded = {
      x: roundMm(next.x),
      y: roundMm(next.y),
      w: roundMm(next.w),
      h: roundMm(next.h),
    }
    geometry.set(id, rounded)
    node.style.left = `${rounded.x}mm`
    node.style.top = `${rounded.y}mm`
    node.style.width = `${rounded.w}mm`
    node.style.height = `${rounded.h}mm`
    options.onGeometryChange(id, { ...rounded })
  }

  const gestureListeners = (node: HTMLElement, element: LabelDesignElement, resize: boolean) => ({
    start: () => {
      options.onSelect(element.id)
      options.onGestureStart?.(element.id)
    },
    move: (event: InteractionEvent) => {
      const current = geometry.get(element.id) ?? geometryOf(element)
      const design = options.getDesign()
      const scale = pxPerMm()
      if (!resize) {
        const x = clamp(current.x + Number(event.dx ?? 0) / scale, 0, design.label.widthMm - current.w)
        const y = clamp(current.y + Number(event.dy ?? 0) / scale, 0, design.label.heightMm - current.h)
        commitGeometry(node, element.id, { ...current, x, y })
        return
      }

      const width = Number(event.rect?.width ?? current.w * scale) / scale
      const height = Number(event.rect?.height ?? current.h * scale) / scale
      const edges = event.edges ?? {}
      if (element.type === 'text') {
        const x = clamp(current.x + Number(event.deltaRect?.left ?? 0) / scale, 0, design.label.widthMm - 1)
        const w = clamp(width, 1, design.label.widthMm - x)
        commitGeometry(node, element.id, { ...current, x, w })
        return
      }

      if (element.type === 'qr') {
        const horizontal = edges.left || edges.right
        const vertical = edges.top || edges.bottom
        let size = horizontal && vertical ? Math.max(width, height) : horizontal ? width : height
        size = Math.max(1, size)
        const right = current.x + current.w
        const bottom = current.y + current.h
        let x = edges.left ? right - size : current.x
        let y = edges.top ? bottom - size : current.y
        const maxWidth = edges.left ? right : design.label.widthMm - x
        const maxHeight = edges.top ? bottom : design.label.heightMm - y
        size = Math.min(size, maxWidth, maxHeight)
        x = edges.left ? right - size : x
        y = edges.top ? bottom - size : y
        commitGeometry(node, element.id, { x: Math.max(0, x), y: Math.max(0, y), w: size, h: size })
        return
      }

      const minimum = element.type === 'shape' ? 0.1 : 1
      const x = clamp(current.x + Number(event.deltaRect?.left ?? 0) / scale, 0, design.label.widthMm - minimum)
      const y = clamp(current.y + Number(event.deltaRect?.top ?? 0) / scale, 0, design.label.heightMm - minimum)
      commitGeometry(node, element.id, {
        x,
        y,
        w: clamp(width, minimum, design.label.widthMm - x),
        h: clamp(height, minimum, design.label.heightMm - y),
      })
    },
    end: () => options.onGestureEnd?.(element.id),
  })

  const teardownBindings = () => {
    for (const interactable of interactables) interactable.unset()
    interactables = []
    for (const node of options.root.querySelectorAll<HTMLElement>('[data-label-interaction-bound]')) {
      node.removeAttribute('data-label-interaction-bound')
      node.style.removeProperty('cursor')
    }
  }

  const refresh = () => {
    if (destroyed) return
    teardownBindings()
    const design = options.getDesign()
    geometry = new Map(design.elements.map(element => [element.id, geometryOf(element)]))
    for (const node of options.root.querySelectorAll<HTMLElement>('[data-label-element-id]')) {
      const id = node.dataset.labelElementId
      const element = design.elements.find(candidate => candidate.id === id)
      if (!element) continue
      node.setAttribute('data-label-interaction-bound', '')
      node.style.cursor = 'move'
      const interactable = interact(node)
      interactable.draggable({
        listeners: gestureListeners(node, element, false),
        inertia: false,
      })
      const scale = pxPerMm()
      const hasHorizontalMoveTarget = element.w * scale >= MINIMUM_RESIZABLE_AXIS_PX
      const hasVerticalMoveTarget = element.h * scale >= MINIMUM_RESIZABLE_AXIS_PX
      if (hasHorizontalMoveTarget && (element.type === 'text' || hasVerticalMoveTarget)) {
        interactable.resizable({
          edges: element.type === 'text'
            ? { left: true, right: true, top: false, bottom: false }
            : { left: true, right: true, top: true, bottom: true },
          listeners: gestureListeners(node, element, true),
          inertia: false,
          margin: RESIZE_EDGE_MARGIN_PX,
        })
      }
      interactables.push(interactable)
    }
  }

  refresh()
  return {
    refresh,
    destroy() {
      if (destroyed) return
      destroyed = true
      options.root.removeEventListener('click', selectFromEvent)
      teardownBindings()
    },
  }
}
