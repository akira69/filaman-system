// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { renderFreeformLabel } from './render'
import type { LabelDesignV2 } from './types'
import type { SpoolData } from '../label-template'

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
})

describe('freeform label rendering', () => {
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
