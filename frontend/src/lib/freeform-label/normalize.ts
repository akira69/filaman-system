import {
  LABEL_FONT_FAMILIES,
  LABEL_FONT_WEIGHTS,
  type LabelDesignElement,
  type LabelDesignV2,
  type LabelElementBase,
  type LabelTextElement,
} from './types'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function choiceOr<const T extends readonly unknown[]>(value: unknown, choices: T, fallback: T[number]): T[number] {
  return choices.includes(value) ? value as T[number] : fallback
}

function textOr(value: unknown, fallback = '', max = 8000): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function colorOr(value: unknown, fallback: string, allowEmpty = false): string {
  if (allowEmpty && value === '') return ''
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toUpperCase() : fallback
}

function normalizeBox(
  raw: Record<string, unknown>,
  label: LabelDesignV2['label'],
  z: number,
  fallback: { w: number; h: number },
  square = false,
  minimum = { w: 3, h: 3 },
): LabelElementBase {
  const w = numberIn(raw.w, minimum.w, label.widthMm, fallback.w)
  const h = square ? w : numberIn(raw.h, minimum.h, label.heightMm, fallback.h)
  return {
    id: textOr(raw.id, '', 120).trim(),
    type: textOr(raw.type) as LabelElementBase['type'],
    x: numberIn(raw.x, 0, label.widthMm - w, 0),
    y: numberIn(raw.y, 0, label.heightMm - h, 0),
    w,
    h,
    z,
  }
}

function normalizeTextElement(
  raw: Record<string, unknown>,
  label: LabelDesignV2['label'],
  z: number,
): LabelTextElement {
  return {
    ...normalizeBox(raw, label, z, { w: 20, h: 8 }),
    type: 'text',
    template: textOr(raw.template),
    fontFamily: choiceOr(raw.fontFamily, LABEL_FONT_FAMILIES, 'Space Grotesk'),
    fontSizeMm: numberIn(raw.fontSizeMm, 1, 20, 3.2),
    fontWeight: choiceOr(raw.fontWeight, LABEL_FONT_WEIGHTS, 600),
    italic: booleanOr(raw.italic, false),
    underline: booleanOr(raw.underline, false),
    align: choiceOr(raw.align, ['left', 'center', 'right'] as const, 'left'),
    color: colorOr(raw.color, '#000000'),
    wrap: booleanOr(raw.wrap, true),
    ...(typeof raw.fitToWidth === 'boolean' ? { fitToWidth: raw.fitToWidth } : {}),
  }
}

function normalizeElement(
  raw: Record<string, unknown>,
  label: LabelDesignV2['label'],
  z: number,
): LabelDesignElement | null {
  switch (raw.type) {
    case 'text':
      return normalizeTextElement(raw, label, z)
    case 'qr':
      return {
        ...normalizeBox(raw, label, z, { w: 18, h: 18 }, true),
        type: 'qr',
        mode: choiceOr(raw.mode, ['simple', 'logo', 'colorLogo'] as const, 'logo'),
        linkMode: choiceOr(raw.linkMode, ['spool', 'url'] as const, 'spool'),
        urlTemplate: textOr(raw.urlTemplate),
      }
    case 'manufacturerLogo':
      return {
        ...normalizeBox(raw, label, z, { w: 25, h: 6 }),
        type: 'manufacturerLogo',
        objectFit: 'contain',
      }
    case 'image':
      return {
        ...normalizeBox(raw, label, z, { w: 20, h: 12 }),
        type: 'image',
        assetId: textOr(raw.assetId, '', 120),
        objectFit: 'contain',
      }
    case 'swatch': {
      const box = normalizeBox(raw, label, z, { w: 30, h: 6 })
      return {
        ...box,
        type: 'swatch',
        radiusMm: numberIn(raw.radiusMm, 0, Math.min(box.w, box.h) / 2, 0),
      }
    }
    case 'shape': {
      const box = normalizeBox(raw, label, z, { w: 20, h: 10 }, false, { w: 0.1, h: 0.1 })
      return {
        ...box,
        type: 'shape',
        shape: 'rectangle',
        fill: colorOr(raw.fill, '', true),
        stroke: colorOr(raw.stroke, '#000000', true),
        strokeWidthMm: numberIn(raw.strokeWidthMm, 0, 10, 0.3),
        radiusMm: numberIn(raw.radiusMm, 0, Math.min(box.w, box.h) / 2, 0),
      }
    }
    default:
      return null
  }
}

export interface NormalizeLabelDesignOptions {
  createId?: () => string
}

const createRandomId = () => crypto.randomUUID()

export function parseLabelElementJson(
  source: string,
  current: LabelDesignElement,
  label: LabelDesignV2['label'],
): LabelDesignElement {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('Element JSON must be valid JSON')
  }
  if (!isRecord(parsed)) throw new Error('Element JSON must contain an object')
  if (parsed.id !== current.id) throw new Error('Element id cannot be changed')
  if (parsed.type !== current.type) throw new Error('Element type cannot be changed')
  const normalized = normalizeElement(parsed, label, current.z)
  if (!normalized) throw new Error('Element type is not supported')
  return normalized
}

export function normalizeLabelDesign(
  raw: unknown,
  options: NormalizeLabelDesignOptions = {},
): LabelDesignV2 {
  const candidate = isRecord(raw) ? raw : {}
  const rawLabel = isRecord(candidate.label) ? candidate.label : {}
  const label: LabelDesignV2['label'] = {
    widthMm: numberIn(rawLabel.widthMm, 20, 300, 60),
    heightMm: numberIn(rawLabel.heightMm, 10, 200, 40),
    marginMm: numberIn(rawLabel.marginMm, 0, 6, 1),
    border: booleanOr(rawLabel.border, false),
  }
  const elements: LabelDesignElement[] = []
  if (Array.isArray(candidate.elements)) {
    for (const rawElement of candidate.elements) {
      if (!isRecord(rawElement)) continue
      const element = normalizeElement(rawElement, label, elements.length)
      if (element) elements.push(element)
    }
  }
  const createId = options.createId ?? createRandomId
  const usedIds = new Set<string>()
  for (const element of elements) {
    let id = element.id
    if (!id || usedIds.has(id)) {
      do {
        id = createId().trim().slice(0, 120)
      } while (!id || usedIds.has(id))
      element.id = id
    }
    usedIds.add(id)
  }
  return { version: 2, label, elements }
}
