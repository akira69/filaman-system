/**
 * One-way compatibility adapter for FilaMan schema v1 presets. Its absolute
 * element layout follows the migration approach used by Donkie/Spoolman's
 * MIT-licensed label designer at commit 81636f2.
 */
import {
  LEGACY_DESIGNER_DEFAULTS,
  type LegacyInfoSettings,
  type LegacyLabelDesignerSettings,
  type LegacyTitleSettings,
} from './legacy-v1'
import { normalizeLabelDesign } from './normalize'
import type {
  LabelDesignElement,
  LabelDesignerPresetData,
  LabelElementIdFactory,
  LabelKind,
} from './types'

const makeId: LabelElementIdFactory = () => crypto.randomUUID()

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function choiceOr<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback
}

function titleSettings(raw: unknown, defaults: LegacyTitleSettings): LegacyTitleSettings {
  const value = record(raw)
  return {
    show: boolOr(value.show, defaults.show),
    sizeMm: numberOr(value.sizeMm, defaults.sizeMm),
    marginMm: numberOr(value.marginMm, defaults.marginMm),
    fitToWidth: boolOr(value.fitToWidth, defaults.fitToWidth),
    align: choiceOr(value.align, ['left', 'center', 'right'], defaults.align),
    template: stringOr(value.template, defaults.template),
    dividerAbove: boolOr(value.dividerAbove, defaults.dividerAbove),
    dividerBelow: boolOr(value.dividerBelow, defaults.dividerBelow),
  }
}

function infoSettings(raw: unknown, defaults: LegacyInfoSettings): LegacyInfoSettings {
  const value = record(raw)
  return {
    show: boolOr(value.show, defaults.show),
    sizeMm: numberOr(value.sizeMm, defaults.sizeMm),
    hAlign: choiceOr(value.hAlign, ['left', 'center', 'right'], defaults.hAlign),
    vAlign: choiceOr(value.vAlign, ['top', 'center', 'bottom'], defaults.vAlign),
    template: stringOr(value.template, defaults.template),
  }
}

function normalizeLegacySettings(raw: unknown): LegacyLabelDesignerSettings {
  const value = record(raw)
  const label = record(value.label)
  const logo = record(value.logo)
  const qr = record(value.qr)
  const info = record(value.info)
  const info2 = record(value.info2)
  const rawQrMode = qr.mode
  const qrMode = rawQrMode === 'colorLogo'
    ? 'colorLogo'
    : rawQrMode === 'logo'
      ? 'logo'
      : rawQrMode === 'icon'
        ? (qr.colorLogo === true ? 'colorLogo' : 'logo')
        : 'simple'
  return {
    label: {
      width: numberOr(label.width, LEGACY_DESIGNER_DEFAULTS.label.width),
      height: numberOr(label.height, LEGACY_DESIGNER_DEFAULTS.label.height),
      marginMm: numberOr(label.marginMm, LEGACY_DESIGNER_DEFAULTS.label.marginMm),
      border: boolOr(label.border, LEGACY_DESIGNER_DEFAULTS.label.border),
    },
    logo: {
      show: boolOr(logo.show, LEGACY_DESIGNER_DEFAULTS.logo.show),
      spaceMm: numberOr(logo.spaceMm, LEGACY_DESIGNER_DEFAULTS.logo.spaceMm),
      scaleToFit: boolOr(logo.scaleToFit, LEGACY_DESIGNER_DEFAULTS.logo.scaleToFit),
      manualSizeMm: numberOr(logo.manualSizeMm, LEGACY_DESIGNER_DEFAULTS.logo.manualSizeMm),
      align: choiceOr(logo.align, ['left', 'center', 'right'], LEGACY_DESIGNER_DEFAULTS.logo.align),
    },
    title: titleSettings(value.title, LEGACY_DESIGNER_DEFAULTS.title),
    title2: titleSettings(value.title2, LEGACY_DESIGNER_DEFAULTS.title2),
    qr: {
      show: boolOr(qr.show, rawQrMode === 'none' ? false : LEGACY_DESIGNER_DEFAULTS.qr.show),
      mode: qrMode,
      sizeMm: numberOr(qr.sizeMm, LEGACY_DESIGNER_DEFAULTS.qr.sizeMm),
      position: choiceOr(qr.position, ['left', 'right'], LEGACY_DESIGNER_DEFAULTS.qr.position),
      vAlign: choiceOr(qr.vAlign, ['top', 'center', 'bottom'], LEGACY_DESIGNER_DEFAULTS.qr.vAlign),
      linkMode: choiceOr(qr.linkMode, ['spool', 'url'], LEGACY_DESIGNER_DEFAULTS.qr.linkMode),
      urlTemplate: stringOr(qr.urlTemplate, LEGACY_DESIGNER_DEFAULTS.qr.urlTemplate),
    },
    info: {
      ...infoSettings(info, LEGACY_DESIGNER_DEFAULTS.info),
      marginMm: numberOr(info.marginMm, LEGACY_DESIGNER_DEFAULTS.info.marginMm),
    },
    info2: {
      ...infoSettings(info2, LEGACY_DESIGNER_DEFAULTS.info2),
      vsep: boolOr(info2.vsep, LEGACY_DESIGNER_DEFAULTS.info2.vsep),
    },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function migrateV1PresetData(
  rawData: unknown,
  _kind: LabelKind,
  createId: LabelElementIdFactory = makeId,
): LabelDesignerPresetData {
  const data = record(rawData)
  const source = 'settings' in data ? data.settings : rawData
  const legacy = normalizeLegacySettings(source)
  const margin = Math.max(0, legacy.label.marginMm)
  const contentW = Math.max(3, legacy.label.width - margin * 2)
  const contentH = Math.max(3, legacy.label.height - margin * 2)
  const elements: LabelDesignElement[] = []
  const id = () => createId()
  let cursorY = margin

  if (legacy.logo.show) {
    const h = Math.min(contentH, Math.max(3, legacy.logo.spaceMm))
    const w = Math.min(contentW, Math.max(12, contentW * 0.45))
    const x = legacy.logo.align === 'center'
      ? margin + (contentW - w) / 2
      : legacy.logo.align === 'right'
        ? margin + contentW - w
        : margin
    elements.push({ id: id(), type: 'manufacturerLogo', x, y: cursorY, w, h, z: elements.length, objectFit: 'contain' })
    cursorY += h + 0.5
  }

  const addDivider = () => {
    elements.push({
      id: id(), type: 'shape', x: margin, y: cursorY, w: contentW, h: 0.3,
      z: elements.length, shape: 'rectangle', fill: '#000000', stroke: '',
      strokeWidthMm: 0, radiusMm: 0,
    })
    cursorY += 0.3
  }
  const addTitle = (title: LegacyTitleSettings) => {
    if (!title.show || !title.template.trim()) return
    cursorY += Math.max(-1, Math.min(4, title.marginMm))
    if (title.dividerAbove) addDivider()
    const h = Math.max(3, title.sizeMm * 1.25)
    elements.push({
      id: id(), type: 'text', x: margin, y: cursorY, w: contentW, h,
      z: elements.length, template: title.template, fontFamily: 'Space Grotesk',
      fontSizeMm: title.sizeMm, fontWeight: 700, italic: false, underline: false,
      align: title.align, color: '#000000', wrap: !title.fitToWidth,
      fitToWidth: title.fitToWidth,
    })
    cursorY += h
    if (title.dividerBelow) addDivider()
  }
  addTitle(legacy.title)
  addTitle(legacy.title2)

  const remainingY = Math.min(legacy.label.height - margin - 3, cursorY + Math.max(-1, legacy.info.marginMm))
  const remainingH = Math.max(3, legacy.label.height - margin - remainingY)
  let infoX = margin
  let infoW = contentW
  if (legacy.qr.show) {
    const size = Math.min(legacy.qr.sizeMm, contentW, remainingH)
    const qrX = legacy.qr.position === 'left' ? margin : margin + contentW - size
    const qrY = legacy.qr.vAlign === 'top'
      ? remainingY
      : legacy.qr.vAlign === 'center'
        ? remainingY + (remainingH - size) / 2
        : remainingY + remainingH - size
    elements.push({
      id: id(), type: 'qr', x: qrX, y: qrY, w: size, h: size, z: elements.length,
      mode: legacy.qr.mode, linkMode: legacy.qr.linkMode, urlTemplate: legacy.qr.urlTemplate,
    })
    infoW = Math.max(3, contentW - size - 1)
    if (legacy.qr.position === 'left') infoX = margin + size + 1
  }

  const visibleInfo = [legacy.info, legacy.info2].filter(section => section.show && section.template.trim())
  visibleInfo.forEach((section, index) => {
    const w = infoW / visibleInfo.length
    elements.push({
      id: id(), type: 'text', x: infoX + index * w, y: remainingY, w, h: remainingH,
      z: elements.length, template: section.template, fontFamily: 'Space Grotesk',
      fontSizeMm: section.sizeMm, fontWeight: 400, italic: false, underline: false,
      align: section.hAlign, color: '#000000', wrap: true,
    })
  })

  const design = normalizeLabelDesign({
    version: 2,
    label: {
      widthMm: legacy.label.width,
      heightMm: legacy.label.height,
      marginMm: legacy.label.marginMm,
      border: legacy.label.border,
    },
    elements,
  }, { createId })
  return { version: 2, design, legacy_v1: clone(source) }
}

export function normalizeDesignerPresetData(
  rawData: unknown,
  kind: LabelKind,
  createId: LabelElementIdFactory = makeId,
): LabelDesignerPresetData {
  const data = record(rawData)
  if (data.version === 2 && record(data.design).version === 2) {
    const normalized: LabelDesignerPresetData = {
      version: 2,
      design: normalizeLabelDesign(data.design, { createId }),
    }
    if ('legacy_v1' in data) normalized.legacy_v1 = clone(data.legacy_v1)
    return normalized
  }
  if (('version' in data && data.version !== 1) || 'design' in data) {
    throw new Error('Unsupported label preset version; the original preset has been preserved')
  }
  return migrateV1PresetData(rawData, kind, createId)
}
