// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { renderFreeformLabel } from './render'
import { normalizeLabelDesign } from './normalize'
import { getTemplateSelectionRange } from './template-selection'
import type { LabelDesignV2 } from './types'
import type { SpoolData } from '../label-template'
import { setLang } from '../i18n'

const data = {
  id: 42,
  'filament.id': '8',
  'filament.name': 'Galaxy PLA',
  'filament.material': 'PLA',
  'filament.type': 'PLA',
  'filament.color': 'Nebula',
  'filament.colors': 'Blue, Purple',
  'filament.color_hex': '#123456',
  'filament.color_hexes': '#123456,#654321',
  'filament.manufacturer': 'Example Filaments',
  'filament.manufacturer_id': '5',
  'filament.color_mode': 'multi',
  'filament.multi_color_style': 'gradient',
  'filament.extruder_temp': 215,
  'filament.bed_temp': 60,
  'filament.raw_material_weight_g': 1000,
  'filament.weight': 1000,
} satisfies SpoolData

const design: LabelDesignV2 = {
  version: 2,
  label: { widthMm: 60, heightMm: 40, marginMm: 1, border: true },
  elements: [
    { id: 'text', type: 'text', x: 2, y: 3, w: 30, h: 8, z: 0, template: '**{filament.name}**', fontFamily: 'Fraunces', fontSizeMm: 4, fontWeight: 600, italic: true, underline: true, align: 'center', color: '#123456', wrap: false },
    { id: 'qr', type: 'qr', x: 40, y: 2, w: 16, h: 16, z: 1, mode: 'simple', linkMode: 'spool', urlTemplate: '' },
    { id: 'logo', type: 'manufacturerLogo', x: 2, y: 13, w: 25, h: 5, z: 2, objectFit: 'contain' },
    { id: 'image', type: 'image', x: 30, y: 20, w: 12, h: 8, z: 3, assetId: 'asset-1', objectFit: 'contain' },
    { id: 'swatch', type: 'swatch', x: 2, y: 30, w: 20, h: 5, z: 4, radiusMm: 1 },
    { id: 'shape', type: 'shape', x: 25, y: 30, w: 30, h: 0.3, z: 5, shape: 'rectangle', fill: '#ABCDEF', stroke: '#000000', strokeWidthMm: 0.2, radiusMm: 0 },
  ],
}

class FakeQrCode {
  static CorrectLevel = { H: 'H' }

  constructor(root: HTMLElement, options: { text: string }) {
    const node = document.createElement('span')
    node.dataset.qrText = options.text
    root.appendChild(node)
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="label"></div>'
  Object.assign(window, { QRCode: FakeQrCode })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'QRCode')
  setLang('en')
})

describe('freeform label rendering', () => {
  it.each([
    [undefined, 'flex-start'], ['top', 'flex-start'], ['middle', 'center'], ['bottom', 'flex-end'],
  ] as const)('places the complete inline text block at %s in previews and print output', async (verticalAlign, justifyContent) => {
    const root = document.querySelector<HTMLElement>('#label')!
    const textDesign = normalizeLabelDesign({ ...design, elements: [{ ...design.elements[0], verticalAlign, wrap: true }] })
    for (const interactive of [true, false]) {
      await renderFreeformLabel({ element: root, design: textDesign, data, interactive })
      const text = root.querySelector<HTMLElement>('[data-label-element-id="text"]')!
      expect(text.style.display).toBe('flex')
      expect(text.style.flexDirection).toBe('column')
      expect(text.style.justifyContent).toBe(justifyContent)
      expect(text.firstElementChild?.textContent).toBe('Galaxy PLA')
      expect((text.firstElementChild as HTMLElement).style.flexShrink).toBe('0')
      expect(text.style.textAlign).toBe('center')
      expect(text.style.whiteSpace).toBe('normal')
    }
  })

  it.each([[true, 'normal', 'anywhere'], [false, 'nowrap', 'normal']] as const)('renders persisted wrap=%s in previews and print output', async (wrap, whiteSpace, overflowWrap) => {
    const root = document.querySelector<HTMLElement>('#label')!
    const textDesign = normalizeLabelDesign({ ...design, elements: [{ ...design.elements[0], wrap }] })
    for (const interactive of [true, false]) {
      await renderFreeformLabel({ element: root, design: textDesign, data, interactive })
      const text = root.querySelector<HTMLElement>('[data-label-element-id="text"]')!
      expect(text.style.whiteSpace).toBe(whiteSpace)
      expect(text.style.overflowWrap).toBe(overflowWrap)
    }
  })

  it('stores the QR library encoded module count on the rendered artwork', async () => {
    class ModuleAwareQrCode {
      static CorrectLevel = { H: 'H' }
      _oQRCode = { getModuleCount: () => 37 }

      constructor(root: HTMLElement) {
        root.appendChild(document.createElement('canvas'))
      }
    }
    Object.assign(window, { QRCode: ModuleAwareQrCode })

    const root = document.querySelector<HTMLElement>('#label')!
    await renderFreeformLabel({
      element: root,
      design: { ...design, elements: [design.elements.find(element => element.type === 'qr')!] },
      data,
    })

    expect(root.querySelector<HTMLElement>('[data-label-element-id="qr"]')?.dataset.qrModuleCount).toBe('37')
  })

  it('shows margin-based grey guides only in the editor and clips normal output', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    await renderFreeformLabel({ element: root, design, data, interactive: true })
    const guide = root.querySelector<HTMLElement>('[data-label-margin-guide]')!
    expect(guide).not.toBeNull()
    expect(guide.hasAttribute('data-label-editor-chrome')).toBe(true)
    expect(guide.style.inset).toBe('1mm')
    expect(guide.style.pointerEvents).toBe('none')
    expect(guide.style.boxShadow).not.toBe('')
    expect(root.style.overflow).toBe('visible')
    expect(root.style.width).toBe('60mm')
    expect(root.style.getPropertyValue('--inner-border-style')).toBe('0.3mm solid black')
    await renderFreeformLabel({ element: root, design, data, interactive: false })
    expect(root.querySelector('[data-label-editor-chrome]')).toBeNull()
    expect(root.style.overflow).toBe('hidden')
  })

  it('reveals an already-cached cropped image without waiting for another load event', async () => {
    const prototype = HTMLImageElement.prototype
    const originals = new Map<string, PropertyDescriptor | undefined>()
    const define = (property: string, value: number | boolean) => {
      originals.set(property, Object.getOwnPropertyDescriptor(prototype, property))
      Object.defineProperty(prototype, property, { configurable: true, get: () => value })
    }
    define('complete', true)
    define('naturalWidth', 1200)
    define('naturalHeight', 600)

    try {
      const root = document.querySelector<HTMLElement>('#label')!
      const cropped = normalizeLabelDesign({
        ...design,
        elements: [{
          ...design.elements.find(element => element.type === 'image')!,
          crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
        }],
      })
      await renderFreeformLabel({
        element: root,
        design: cropped,
        data,
        resolveAssetUrl: () => '/cached.png',
      })

      const viewport = root.querySelector<HTMLElement>('[data-label-image-crop-viewport]')!
      expect(viewport.style.getPropertyValue('--label-image-crop-aspect')).toBe('2')
      expect(viewport.style.visibility).toBe('visible')
    } finally {
      for (const [property, descriptor] of originals) {
        if (descriptor) Object.defineProperty(prototype, property, descriptor)
        else Reflect.deleteProperty(prototype, property)
      }
    }
  })

  it('contains a cropped landscape image with percentage geometry that survives cloning', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    const cropped = normalizeLabelDesign({
      ...design,
      elements: [{
        ...design.elements.find(element => element.type === 'image')!,
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
      }],
    })
    await renderFreeformLabel({
      element: root,
      design: cropped,
      data,
      resolveAssetUrl: () => '/wide.png',
    })

    const image = root.querySelector<HTMLImageElement>('img')!
    expect(image.dataset.labelImageCropAspectFactor).toBe('1')
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 600 },
    })
    image.dispatchEvent(new Event('load'))

    const viewport = image.parentElement!
    expect(image).toBeInstanceOf(HTMLImageElement)
    expect(image.style.objectFit).toBe('contain')
    expect(image.style.position).toBe('absolute')
    expect(image.style.width).toBe('200%')
    expect(image.style.height).toBe('200%')
    expect(image.style.left).toBe('-20%')
    expect(image.style.top).toBe('-40%')
    expect(viewport.dataset.labelImageCropViewport).toBe('')
    expect(viewport.style.overflow).toBe('hidden')
    expect(viewport.style.getPropertyValue('--label-image-crop-aspect')).toBe('2')
    expect(viewport.style.visibility).toBe('visible')
    expect(viewport.parentElement!.style.containerType).toBe('size')

    viewport.parentElement!.style.width = '6mm'
    viewport.parentElement!.style.height = '20mm'
    const clone = viewport.parentElement!.cloneNode(true) as HTMLElement
    expect(clone.querySelector('img')!.style.left).toBe('-20%')
    expect(clone.querySelector<HTMLElement>('[data-label-image-crop-viewport]')!.style
      .getPropertyValue('--label-image-crop-aspect')).toBe('2')
    expect(clone.querySelector('style')).toBeNull()
  })

  it('contains a cropped portrait image without distortion', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    const cropped = normalizeLabelDesign({
      ...design,
      elements: [{
        ...design.elements.find(element => element.type === 'image')!,
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
      }],
    })
    await renderFreeformLabel({
      element: root,
      design: cropped,
      data,
      resolveAssetUrl: () => '/tall.png',
    })

    const image = root.querySelector<HTMLImageElement>('img')!
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 600 },
      naturalHeight: { configurable: true, value: 1200 },
    })
    image.dispatchEvent(new Event('load'))

    const viewport = image.parentElement!
    expect(image.style.position).toBe('absolute')
    expect(image.style.width).toBe('200%')
    expect(image.style.height).toBe('200%')
    expect(image.style.left).toBe('-20%')
    expect(image.style.top).toBe('-40%')
    expect(image.style.objectFit).toBe('contain')
    expect(viewport.style.getPropertyValue('--label-image-crop-aspect')).toBe('0.5')
  })

  it('masks uncropped source pixels around a narrow crop', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    const cropped = normalizeLabelDesign({
      ...design,
      elements: [{
        ...design.elements.find(element => element.type === 'image')!,
        w: 12,
        h: 12,
        crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
      }],
    })
    await renderFreeformLabel({
      element: root,
      design: cropped,
      data,
      resolveAssetUrl: () => '/square.png',
    })

    const image = root.querySelector<HTMLImageElement>('img')!
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1000 },
    })
    image.dispatchEvent(new Event('load'))

    const viewport = image.parentElement!
    expect(viewport.dataset.labelImageCropViewport).toBe('')
    expect(viewport.style.overflow).toBe('hidden')
    expect(viewport.style.getPropertyValue('--label-image-crop-aspect')).toBe('0.5')
    expect(image.style.width).toBe('200%')
    expect(image.style.height).toBe('100%')
    expect(image.style.left).toBe('-50%')
    expect(image.style.top).toBe('0%')
  })

  it('keeps the existing contain styles for an image without a crop', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    await renderFreeformLabel({
      element: root,
      design: { ...design, elements: [design.elements.find(element => element.type === 'image')!] },
      data,
      resolveAssetUrl: () => '/uncropped.png',
    })

    const image = root.querySelector<HTMLImageElement>('img')!
    expect(image.style.position).toBe('')
    expect(image.style.width).toBe('100%')
    expect(image.style.height).toBe('100%')
    expect(image.style.objectFit).toBe('contain')
  })

  it.each([false, true])('renders basic shapes consistently for output and interactive preview (%s)', async interactive => {
    const root = document.querySelector<HTMLElement>('#label')!
    const shapes = normalizeLabelDesign({ ...design, elements: ['circle', 'square', 'rectangle', 'line'].map((shape, z) => ({
      id: shape, type: 'shape', shape, x: 2, y: 2, w: 10, h: 10, z,
      stroke: '#123456', strokeWidthMm: 0.3, fill: '#ABCDEF',
    })) })
    await renderFreeformLabel({ element: root, design: shapes, data, interactive })
    expect(root.querySelector<HTMLElement>('[data-label-element-id="circle"]')!.style.borderRadius).toBe('50%')
    expect(root.querySelector<HTMLElement>('[data-label-element-id="square"]')!.style.borderRadius).toBe('0mm')
    expect(root.querySelector<HTMLElement>('[data-label-element-id="rectangle"]')!.style.backgroundColor).toBe('#ABCDEF')
    const line = root.querySelector<HTMLElement>('[data-label-element-id="line"]')!
    expect(line.style.backgroundColor).toBe('')
    expect(line.style.border).toBe('')
    expect((line.firstElementChild as HTMLElement)?.style.borderTop).toBe('0.3mm solid #123456')
    expect(root.querySelector('[data-editor-handle]')).toBeNull()
  })

  it('maps a visible partial field selection back to the whole template token', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    await renderFreeformLabel({ element: root, design: { ...design, elements: [design.elements[0]] }, data, interactive: true })
    const token = root.querySelector('[data-template-atomic]')!
    expect(token).not.toBeNull()
    const range = document.createRange()
    range.setStart(token.firstChild!, 1)
    range.setEnd(token.firstChild!, 4)
    expect(getTemplateSelectionRange(root, range)).toEqual({ start: 2, end: 17 })
  })
  it('renders all element types as absolute millimetre DOM without editor chrome', async () => {
    const root = document.querySelector<HTMLElement>('#label')!

    await renderFreeformLabel({
      element: root,
      design,
      data,
      logoUrl: '/api/v1/manufacturers/5/label-logo',
      resolveAssetUrl: assetId => `/api/v1/me/label-assets/${assetId}/content`,
      entityPath: 'spools',
    })

    expect(root.style.width).toBe('60mm')
    expect(root.style.height).toBe('40mm')
    expect(root.style.position).toBe('relative')
    expect(root.style.getPropertyValue('--inner-border-style')).toBe('0.3mm solid black')
    expect(root.querySelectorAll('[data-label-element-id]')).toHaveLength(6)
    expect(root.querySelector('[data-label-element-id="text"]')?.textContent).toBe('Galaxy PLA')
    expect((root.querySelector('[data-label-element-id="text"]') as HTMLElement).style.cssText).toContain('left: 2mm')
    expect((root.querySelector('[data-label-element-id="text"]') as HTMLElement).style.fontFamily).toContain('Fraunces')
    expect((root.querySelector('[data-label-element-id="logo"] img') as HTMLImageElement).src).toContain('/api/v1/manufacturers/5/label-logo')
    expect((root.querySelector('[data-label-element-id="image"] img') as HTMLImageElement).src).toContain('/api/v1/me/label-assets/asset-1/content')
    expect((root.querySelector('[data-label-element-id="swatch"]') as HTMLElement).style.background).toContain('linear-gradient')
    expect((root.querySelector('[data-label-element-id="shape"]') as HTMLElement).style.height).toBe('0.3mm')
    expect(root.querySelector('[data-editor-handle]')).toBeNull()
  })

  it('leaves the current preview untouched when an asset render becomes stale', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    root.textContent = 'newer preview'
    let stale = false
    let resolveAsset!: (value: string) => void
    const assetUrl = new Promise<string>(resolve => { resolveAsset = resolve })

    const rendering = renderFreeformLabel({
      element: root,
      design: {
        ...design,
        elements: [design.elements.find(element => element.type === 'image')!],
      },
      data,
      resolveAssetUrl: () => assetUrl,
      isStale: () => stale,
    })
    stale = true
    resolveAsset('/api/v1/me/label-assets/asset-1/content')
    await rendering

    expect(root.textContent).toBe('newer preview')
    expect(root.querySelector('[data-label-element-id]')).toBeNull()
  })

  it.each([
    ['en', 'Choose an image'],
    ['de', 'Bild auswählen'],
  ])('shows a neutral unfinished image prompt in %s without resolving an empty asset id', async (language, message) => {
    setLang(language)
    const root = document.querySelector<HTMLElement>('#label')!
    let resolveCount = 0

    await renderFreeformLabel({
      element: root,
      design: {
        ...design,
        elements: [{
          ...design.elements.find(element => element.type === 'image')!,
          assetId: '',
        }],
      },
      data,
      resolveAssetUrl: assetId => {
        resolveCount += 1
        return `/api/v1/me/label-assets/${assetId}/content`
      },
      interactive: true,
    })

    expect(resolveCount).toBe(0)
    expect(root.querySelector('[data-label-element-type="image"]')).not.toBeNull()
    expect(root.querySelector('img')).toBeNull()
    const placeholder = root.querySelector<HTMLElement>('[data-label-output-error]')!
    expect(placeholder.textContent).toBe(message)
    expect(placeholder.dataset.labelOutputError).toContain(message)
    expect(placeholder.style.color).not.toBe('#b91c1c')
    expect(placeholder.style.border).not.toContain('#b91c1c')
    expect(placeholder.getAttribute('aria-label')).toContain(message)
  })

  it('shows an explicit placeholder when an uploaded image fails to load', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    await renderFreeformLabel({
      element: root,
      design: { ...design, elements: [design.elements.find(element => element.type === 'image')!] },
      data,
      resolveAssetUrl: () => '/missing.png',
    })
    root.querySelector('img')!.dispatchEvent(new Event('error'))
    const placeholder = root.querySelector<HTMLElement>('[data-label-output-error]')!
    expect(placeholder.textContent).toBe('Could not load label images')
    expect(placeholder.style.color).toBe('#b91c1c')
  })

  it('keeps an unavailable nonempty image asset visibly marked as a load error', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    await renderFreeformLabel({
      element: root,
      design: { ...design, elements: [design.elements.find(element => element.type === 'image')!] },
      data,
      resolveAssetUrl: () => null,
    })
    const placeholder = root.querySelector<HTMLElement>('[data-label-output-error]')!
    expect(placeholder.textContent).toBe('Could not load label images')
    expect(placeholder.dataset.labelOutputError).toContain('asset-1')
    expect(placeholder.style.color).toBe('#b91c1c')
  })

  it('draws the FilaMan mark in the centre for logo QR elements', async () => {
    const root = document.querySelector<HTMLElement>('#label')!
    const fillTextCalls: unknown[][] = []
    class CanvasQrCode {
      static CorrectLevel = { H: 'H' }

      constructor(qrRoot: HTMLElement) {
        const canvas = document.createElement('canvas')
        Object.defineProperty(canvas, 'getContext', {
          value: () => ({
            fillRect() {},
            fillText(...args: unknown[]) { fillTextCalls.push(args) },
            measureText: () => ({ width: 90 }),
          }),
        })
        qrRoot.appendChild(canvas)
      }
    }
    Object.assign(window, { QRCode: CanvasQrCode })

    await renderFreeformLabel({
      element: root,
      design: {
        ...design,
        elements: [{
          ...design.elements.find(element => element.type === 'qr')!,
          mode: 'logo',
        }],
      },
      data,
    })

    expect(fillTextCalls).toContainEqual(['FilaMan', 189, 189])
  })
})
