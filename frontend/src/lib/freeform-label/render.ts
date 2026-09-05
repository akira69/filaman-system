import {
  buildFilamentSwatchBackground,
  getFilamentSwatchColors,
  parseTemplate,
  type SpoolData,
} from '../label-template'
import { decorateQrCenter, ensureQrCodeLoaded, getQrCodeConstructor } from '../qr-code'
import { normalizeLabelDesign } from './normalize'
import type { LabelDesignElement, LabelDesignV2 } from './types'

export interface RenderFreeformLabelOptions {
  element: HTMLElement
  design: LabelDesignV2
  data: SpoolData
  logoUrl?: string | null
  resolveAssetUrl?: (assetId: string) => string | null | Promise<string | null>
  previewBorder?: boolean
  interactive?: boolean
  isStale?: () => boolean
  entityPath?: 'spools' | 'filaments'
}

function applyGeometry(node: HTMLElement, element: LabelDesignElement) {
  node.dataset.labelElementId = element.id
  node.dataset.labelElementType = element.type
  node.style.position = 'absolute'
  node.style.left = `${element.x}mm`
  node.style.top = `${element.y}mm`
  node.style.width = `${element.w}mm`
  node.style.height = `${element.h}mm`
  node.style.zIndex = String(element.z)
  node.style.boxSizing = 'border-box'
  node.style.overflow = 'hidden'
}

function createImage(src: string, alt: string) {
  const image = document.createElement('img')
  image.src = src
  image.alt = alt
  image.draggable = false
  image.style.display = 'block'
  image.style.width = '100%'
  image.style.height = '100%'
  image.style.objectFit = 'contain'
  return image
}

function buildQrUrl(
  linkMode: 'spool' | 'url',
  templateBase: string,
  entityId: string | number,
  entityPath: 'spools' | 'filaments',
) {
  if (linkMode === 'url' && templateBase.trim()) {
    try {
      const url = new URL(templateBase.trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}/${entityPath}/${encodeURIComponent(String(entityId))}`
    } catch {
      // Use the current FilaMan origin below.
    }
  }
  return `${window.location.origin}/${entityPath}/${encodeURIComponent(String(entityId))}`
}

function renderText(node: HTMLElement, element: Extract<LabelDesignElement, { type: 'text' }>, data: SpoolData) {
  node.style.fontFamily = `"${element.fontFamily}", sans-serif`
  node.style.fontSize = `${element.fontSizeMm}mm`
  node.style.fontWeight = String(element.fontWeight)
  node.style.fontStyle = element.italic ? 'italic' : 'normal'
  node.style.textDecoration = element.underline ? 'underline' : 'none'
  node.style.textAlign = element.align
  node.style.color = element.color
  node.style.lineHeight = '1.15'
  node.style.whiteSpace = element.wrap ? 'normal' : 'nowrap'
  node.style.overflowWrap = element.wrap ? 'anywhere' : 'normal'
  node.appendChild(parseTemplate(element.template, data))
}

async function renderQr(
  node: HTMLElement,
  element: Extract<LabelDesignElement, { type: 'qr' }>,
  data: SpoolData,
  entityPath: 'spools' | 'filaments',
) {
  const QRCode = getQrCodeConstructor()
  if (!QRCode) throw new Error('QRCode is not available')
  const entityId = entityPath === 'filaments' ? data['filament.id'] : data.id
  const qrPx = Math.min(1024, Math.max(256, Math.round(element.w * (600 / 25.4))))
  new QRCode(node, {
    text: buildQrUrl(element.linkMode, element.urlTemplate, entityId, entityPath),
    width: qrPx,
    height: qrPx,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H,
  })
  const canvas = node.querySelector<HTMLCanvasElement>('canvas')
  if (canvas && element.mode !== 'simple') {
    await decorateQrCenter(canvas, qrPx, element.mode === 'colorLogo')
  }
  for (const child of node.querySelectorAll<HTMLElement>('canvas, img')) {
    child.style.width = '100%'
    child.style.height = '100%'
    child.style.display = 'block'
  }
}

function applyRootStyles(root: HTMLElement, design: LabelDesignV2, options: RenderFreeformLabelOptions) {
  root.style.width = `${design.label.widthMm}mm`
  root.style.height = `${design.label.heightMm}mm`
  root.style.padding = '0'
  root.style.position = 'relative'
  root.style.boxSizing = 'border-box'
  root.style.overflow = 'hidden'
  root.style.background = '#ffffff'
  root.style.border = options.previewBorder === false ? 'none' : '1px dashed #ccc'
  root.style.setProperty('--print-label-padding', '0mm')
  root.style.setProperty('--inner-border-style', design.label.border ? '0.3mm solid black' : 'none')
  root.style.setProperty('--inner-border-inset', `${design.label.marginMm}mm`)
  root.toggleAttribute('data-label-interactive', options.interactive === true)
}

export async function renderFreeformLabel(options: RenderFreeformLabelOptions) {
  const design = normalizeLabelDesign(options.design)
  const hasQr = design.elements.some(element => element.type === 'qr')
  if (hasQr) await ensureQrCodeLoaded()
  if (options.isStale?.()) return

  const nodes: HTMLElement[] = []
  const ordered = [...design.elements].sort((left, right) => left.z - right.z)
  for (const element of ordered) {
    if (options.isStale?.()) return
    const node = document.createElement('div')
    applyGeometry(node, element)
    switch (element.type) {
      case 'text':
        renderText(node, element, options.data)
        break
      case 'qr':
        await renderQr(node, element, options.data, options.entityPath ?? 'spools')
        break
      case 'manufacturerLogo':
        if (options.logoUrl) node.appendChild(createImage(options.logoUrl, ''))
        break
      case 'image': {
        const src = await options.resolveAssetUrl?.(element.assetId)
        if (options.isStale?.()) return
        if (src) node.appendChild(createImage(src, ''))
        break
      }
      case 'swatch': {
        const colors = getFilamentSwatchColors(
          options.data['filament.color_hexes'],
          options.data['filament.color_hex'],
        )
        node.style.background = buildFilamentSwatchBackground(
          colors,
          options.data['filament.multi_color_style'],
        ) || '#9aa0a6'
        node.style.border = '0.12mm solid rgba(0, 0, 0, 0.35)'
        node.style.borderRadius = `${element.radiusMm}mm`
        break
      }
      case 'shape':
        node.style.backgroundColor = element.fill || 'transparent'
        node.style.border = element.stroke && element.strokeWidthMm > 0
          ? `${element.strokeWidthMm}mm solid ${element.stroke}`
          : 'none'
        node.style.borderRadius = `${element.radiusMm}mm`
        break
    }
    nodes.push(node)
  }
  if (options.isStale?.()) return
  options.element.replaceChildren(...nodes)
  applyRootStyles(options.element, design, options)
}
