import { describe, expect, it } from 'vitest'

import { createDefaultLabelDesign } from './defaults'
import { normalizeLabelDesign, parseLabelElementJson } from './normalize'

describe('freeform label defaults', () => {
  it('creates a spool design with stable unique element identities and millimetre geometry', () => {
    const ids = ['text-1', 'qr-1', 'logo-1', 'swatch-1']
    const design = createDefaultLabelDesign('spool', () => ids.shift()!)

    expect(design.version).toBe(2)
    expect(design.label).toEqual({
      widthMm: 60,
      heightMm: 40,
      marginMm: 1,
      border: false,
    })
    expect(design.elements.map(element => element.id)).toEqual([
      'text-1',
      'qr-1',
      'logo-1',
      'swatch-1',
    ])
    expect(new Set(design.elements.map(element => element.id)).size).toBe(4)
    expect(design.elements.every(element => (
      element.x >= 0
      && element.y >= 0
      && element.w > 0
      && element.h > 0
    ))).toBe(true)
  })
})

describe('freeform label normalization', () => {
  it('returns a sanitized copy with bounded label and element geometry', () => {
    const raw = {
      version: 2,
      ignored: 'remove me',
      label: { widthMm: 500, heightMm: 2, marginMm: -5, border: 1 },
      elements: [{
        id: 'title',
        type: 'text',
        x: -4,
        y: 500,
        w: 900,
        h: 0,
        z: 99,
        template: '{filament.name}',
        fontFamily: 'Comic Sans',
        fontSizeMm: 80,
        fontWeight: 900,
        italic: 'yes',
        underline: true,
        align: 'sideways',
        color: 'red<script>',
        wrap: false,
        ignored: true,
      }],
    }

    const normalized = normalizeLabelDesign(raw)

    expect(normalized).toEqual({
      version: 2,
      label: { widthMm: 300, heightMm: 10, marginMm: 0, border: false },
      elements: [{
        id: 'title',
        type: 'text',
        x: 0,
        y: 7,
        w: 300,
        h: 3,
        z: 0,
        template: '{filament.name}',
        fontFamily: 'Space Grotesk',
        fontSizeMm: 20,
        fontWeight: 600,
        italic: false,
        underline: true,
        align: 'left',
        color: '#000000',
        wrap: false,
      }],
    })
    expect(raw.elements[0].x).toBe(-4)
  })

  it('normalizes every supported element type and keeps QR geometry square', () => {
    const design = normalizeLabelDesign({
      version: 2,
      label: { widthMm: 60, heightMm: 40 },
      elements: [
        { id: 'qr', type: 'qr', x: 2, y: 3, w: 12, h: 18, mode: 'colorLogo', linkMode: 'url', urlTemplate: 'https://example.test' },
        { id: 'logo', type: 'manufacturerLogo', x: 1, y: 1, w: 30, h: 6, objectFit: 'cover' },
        { id: 'image', type: 'image', x: 4, y: 4, w: 20, h: 10, assetId: 'asset-1', objectFit: 'cover' },
        { id: 'swatch', type: 'swatch', x: 5, y: 30, w: 50, h: 5, radiusMm: 20 },
        { id: 'shape', type: 'shape', x: 0, y: 0, w: 60, h: 40, shape: 'ellipse', fill: '#abcdef', stroke: '#123456', strokeWidthMm: 30, radiusMm: -2 },
      ],
    })

    expect(design.elements).toEqual([
      { id: 'qr', type: 'qr', x: 2, y: 3, w: 12, h: 12, z: 0, mode: 'colorLogo', linkMode: 'url', urlTemplate: 'https://example.test' },
      { id: 'logo', type: 'manufacturerLogo', x: 1, y: 1, w: 30, h: 6, z: 1, objectFit: 'contain' },
      { id: 'image', type: 'image', x: 4, y: 4, w: 20, h: 10, z: 2, assetId: 'asset-1', objectFit: 'contain' },
      { id: 'swatch', type: 'swatch', x: 5, y: 30, w: 50, h: 5, z: 3, radiusMm: 2.5 },
      { id: 'shape', type: 'shape', x: 0, y: 0, w: 60, h: 40, z: 4, shape: 'rectangle', fill: '#ABCDEF', stroke: '#123456', strokeWidthMm: 10, radiusMm: 0 },
    ])
  })

  it('replaces blank or duplicate ids and compacts z-order after invalid elements', () => {
    const ids = ['generated-1', 'generated-2']
    const design = normalizeLabelDesign({
      label: { widthMm: 60, heightMm: 40 },
      elements: [
        { id: 'same', type: 'text' },
        { id: 'ignored', type: 'video' },
        { id: 'same', type: 'image', assetId: 'asset-1' },
        { id: '  ', type: 'shape' },
      ],
    }, { createId: () => ids.shift()! })

    expect(design.elements.map(element => element.id)).toEqual([
      'same',
      'generated-1',
      'generated-2',
    ])
    expect(design.elements.map(element => element.z)).toEqual([0, 1, 2])
  })

  it('rejects malformed JSON and changes to the selected element identity', () => {
    const current = createDefaultLabelDesign('spool', () => 'selected').elements[0]
    const label = { widthMm: 60, heightMm: 40, marginMm: 1, border: false }

    expect(() => parseLabelElementJson('{', current, label)).toThrow('valid JSON')
    expect(() => parseLabelElementJson(JSON.stringify({
      ...current,
      id: 'replacement',
    }), current, label)).toThrow('id cannot be changed')
    expect(() => parseLabelElementJson(JSON.stringify({
      ...current,
      type: 'shape',
    }), current, label)).toThrow('type cannot be changed')
  })

})
