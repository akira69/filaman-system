/**
 * Millimetre-based label geometry adapted from Donkie/Spoolman's MIT-licensed
 * label designer model at commit 81636f2. This DOM implementation is maintained
 * independently by FilaMan.
 */

export const LABEL_DESIGN_VERSION = 2 as const

export const LABEL_FONT_FAMILIES = [
  'Space Grotesk',
  'Roboto Condensed',
  'Fraunces',
  'Space Mono',
] as const

export const LABEL_FONT_WEIGHTS = [400, 500, 600, 700] as const

export type LabelKind = 'spool' | 'filament'
export type LabelElementType =
  | 'text'
  | 'qr'
  | 'manufacturerLogo'
  | 'image'
  | 'swatch'
  | 'shape'
export type LabelFontFamily = typeof LABEL_FONT_FAMILIES[number]
export type LabelFontWeight = typeof LABEL_FONT_WEIGHTS[number]

export interface LabelElementBase {
  id: string
  type: LabelElementType
  x: number
  y: number
  w: number
  h: number
  z: number
}

export interface LabelTextElement extends LabelElementBase {
  type: 'text'
  template: string
  fontFamily: LabelFontFamily
  fontSizeMm: number
  fontWeight: LabelFontWeight
  italic: boolean
  underline: boolean
  align: 'left' | 'center' | 'right'
  color: string
  wrap: boolean
  /** Shrink single-line preset text to its available width. */
  fitToWidth?: boolean
}

export interface LabelQrElement extends LabelElementBase {
  type: 'qr'
  mode: 'simple' | 'logo' | 'colorLogo'
  linkMode: 'spool' | 'url'
  urlTemplate: string
}

export interface LabelManufacturerLogoElement extends LabelElementBase {
  type: 'manufacturerLogo'
  objectFit: 'contain'
}

export interface LabelImageElement extends LabelElementBase {
  type: 'image'
  assetId: string
  objectFit: 'contain'
}

export interface LabelSwatchElement extends LabelElementBase {
  type: 'swatch'
  radiusMm: number
}

export interface LabelShapeElement extends LabelElementBase {
  type: 'shape'
  shape: 'rectangle'
  fill: string
  stroke: string
  strokeWidthMm: number
  radiusMm: number
}

export type LabelDesignElement =
  | LabelTextElement
  | LabelQrElement
  | LabelManufacturerLogoElement
  | LabelImageElement
  | LabelSwatchElement
  | LabelShapeElement

export interface LabelDesignV2 {
  version: typeof LABEL_DESIGN_VERSION
  label: {
    widthMm: number
    heightMm: number
    marginMm: number
    border: boolean
  }
  elements: LabelDesignElement[]
}

export interface LabelDesignerPresetData {
  version: typeof LABEL_DESIGN_VERSION
  design: LabelDesignV2
  legacy_v1?: unknown
}

export type LabelElementIdFactory = () => string
