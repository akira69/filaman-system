// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { renderDesignerLabel, buildSpoolDataFromFlatLabel } from '../label-designer'
import { renderSvgElementOutput, redrawSvgGesture } from './browser'
import type { LabelDesignV2 } from '../freeform-label/types'

vi.mock('./runtime.mjs', async importOriginal => {
  const module = await importOriginal<typeof import('./runtime.mjs')>()
  return { createSvgRuntime: () => module.createSvgRuntime((path: string) => readFile(`node_modules/${path}`)) }
})
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })
const data = buildSpoolDataFromFlatLabel({ id: 295, designation: 'Ä Ö Ü ß' })
function design(): LabelDesignV2 {
  return { version: 2, label: { widthMm: 40, heightMm: 30, marginMm: 1, border: false }, elements: [
    { id: 'logo', type: 'manufacturerLogo', x: 1, y: 1, w: 38, h: 4, z: 0, objectFit: 'contain', collapseWhenEmpty: true },
    { id: 'title', type: 'text', x: 1, y: 5.5, w: 38, h: 3, z: 1, template: '[if={missing}]gone[/if]', fontSizeMm: 3, legacyTextRole: 'title' },
    { id: 'info', type: 'text', x: 1, y: 9, w: 18, h: 19, z: 2, template: '{filament.name}', fontSizeMm: 2, legacyTextRole: 'info' },
    { id: 'qr', type: 'qr', x: 21, y: 10, w: 18, h: 18, z: 3, mode: 'simple', legacyVAlign: 'bottom' },
  ] as LabelDesignV2['elements'] }
}
function root() { const node = document.createElement('div'); document.body.append(node); return node }

it('mounts shared pixels with authoritative collapsed geometry and topmost QR targets', async () => {
  const element = root()
  await renderDesignerLabel({ element, design: design(), data, interactive: true })
  expect(element.querySelector('[data-label-svg-raster]')).not.toBeNull()
  expect(element.querySelector<HTMLElement>('[data-label-element-id="info"]')?.style.top).toBe('1.5mm')
  expect(element.querySelector('[data-label-element-id="logo"]')).toBeNull()
  expect(element.querySelector('[data-label-element-id="qr"]')?.getAttribute('data-qr-module-count')).toBeTruthy()
  const output = await renderSvgElementOutput(element, 320, 240, true, 0)
  expect(output.mono.every((byte: number) => byte === 0)).toBe(true)
})

it('discards a delayed older asset request and blocks failed/stale output', async () => {
  const element = root()
  let resolve!: (value: string | null) => void
  const imageDesign = design()
  imageDesign.elements = [{ id: 'image', type: 'image', assetId: 'slow', x: 1, y: 1, w: 10, h: 10, z: 0, objectFit: 'contain' }]
  const first = renderDesignerLabel({ element, design: imageDesign, data, interactive: true,
    resolveAssetUrl: () => new Promise(done => { resolve = done }) })
  await renderDesignerLabel({ element, design: design(), data, interactive: true })
  const before = element.innerHTML
  resolve(null)
  await first
  expect(element.innerHTML).toBe(before)
  await renderDesignerLabel({ element, design: imageDesign, data, interactive: true, resolveAssetUrl: () => null })
  expect(element.hasAttribute('data-label-output-error')).toBe(true)
  expect(element.querySelector('[data-label-element-id="image"]')).not.toBeNull()
  await expect(renderSvgElementOutput(element, 320, 240, false)).rejects.toThrow()
})

it('does not replace an active composition surface', async () => {
  const element = root()
  await renderDesignerLabel({ element, design: design(), data, interactive: true })
  const node = element.querySelector('[data-label-element-id="info"]')!
  node.setAttribute('data-label-composing', '')
  await renderDesignerLabel({ element, design: design(), data: { ...data, 'filament.name': 'New' }, interactive: true })
  expect(element.querySelector('[data-label-element-id="info"]')).toBe(node)
  await expect(renderSvgElementOutput(element, 320, 240, false)).rejects.toThrow()
})

it('repaints a gesture without replacing its handles', async () => {
  const element = root(), value = design()
  await renderDesignerLabel({ element, design: value, data, interactive: true })
  const target = element.querySelector('[data-label-element-id="info"]')
  const previous = element.querySelector<HTMLImageElement>('[data-label-svg-raster]')!.src
  value.elements.find(e => e.id === 'info')!.x = 2
  redrawSvgGesture(element, value)
  await new Promise(requestAnimationFrame)
  expect(element.querySelector('[data-label-element-id="info"]')).toBe(target)
  expect(element.querySelector<HTMLImageElement>('[data-label-svg-raster]')!.src).not.toBe(previous)
  expect((await renderSvgElementOutput(element, 320, 240, false)).boxes.find((box: { id: string }) => box.id === 'info').x).toBe(2)
})
