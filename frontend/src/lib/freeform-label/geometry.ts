import type { LabelDesignElement } from './types'

type GeometryElement = {
  type: LabelDesignElement['type']
  shape?: Extract<LabelDesignElement, { type: 'shape' }>['shape']
  crop?: unknown
  w?: unknown
  h?: unknown
}

export function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, candidate))
}

export function clampElementPosition(
  box: { x: number; y: number; w: number; h: number },
  label: { widthMm: number; heightMm: number },
): { x: number; y: number } {
  const overlapX = Math.max(0, Math.min(0.1, box.w))
  const overlapY = Math.max(0, Math.min(0.1, box.h))
  return {
    x: clampFinite(box.x, overlapX - box.w, label.widthMm - overlapX, 0),
    y: clampFinite(box.y, overlapY - box.h, label.heightMm - overlapY, 0),
  }
}

export function getElementMinimumSize(element: GeometryElement): number {
  if (element.type === 'shape') return 0.1
  if (
    element.type === 'image'
    && element.crop
    && typeof element.w === 'number'
    && Number.isFinite(element.w)
    && element.w > 0
    && typeof element.h === 'number'
    && Number.isFinite(element.h)
    && element.h > 0
  ) return Math.min(3, element.w, element.h)
  return 3
}

export function isProportionalElement(element: GeometryElement): boolean {
  return element.type === 'qr'
    || (element.type === 'shape' && (element.shape === 'circle' || element.shape === 'square'))
}
