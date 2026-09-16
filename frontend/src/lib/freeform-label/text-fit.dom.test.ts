// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from 'vitest'
import { migrateV1PresetData } from './migrate-v1'
import { renderFreeformLabel } from './render'
import { waitForLabelOutputAssets } from '../label-output-readiness'
import type { SpoolData } from '../label-template'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'fonts')
  document.body.replaceChildren()
})

it('fits migrated long titles after fonts load, including detached output roots', async () => {
  const original = migrateV1PresetData({ settings: {
    label: { width: 40, height: 20 },
    logo: { show: false }, qr: { show: false }, info: { show: false }, info2: { show: false },
    title: { template: 'Long legacy title', fitToWidth: true, sizeMm: 4 }, title2: { show: false },
  } }, 'spool').design
  // happy-dom has no layout engine. Simulate measurable text only while attached,
  // with a title that needs to shrink from 4 mm to at most 2 mm to fit its box.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.isConnected ? 100 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.isConnected ? Number.parseFloat(this.style.fontSize || this.parentElement?.style.fontSize || '0') * 50 : 0
  })
  let fontsReady!: () => void
  Object.defineProperty(document, 'fonts', { configurable: true, value: {
    ready: new Promise<void>(resolve => { fontsReady = resolve }),
  } })
  const output = document.createElement('div')
  const rendering = renderFreeformLabel({ element: output, design: original, data: {} as SpoolData })
  await Promise.resolve()
  expect(output.children).toHaveLength(0)
  fontsReady()
  await rendering
  const title = output.querySelector<HTMLElement>('[data-label-element-type="text"]')!
  expect(title.textContent).toBe('Long legacy title')
  expect(Number.parseFloat(title.style.fontSize)).toBeGreaterThan(1.9)
  expect(Number.parseFloat(title.style.fontSize)).toBeLessThanOrEqual(2)
  expect(document.body.children).toHaveLength(0)
  expect(original.elements.find(element => element.type === 'text')?.fontSizeMm).toBe(4)
})

it.each(['top', 'middle', 'bottom'] as const)('shrinks wrapped text to its box height with %s alignment without changing the chosen size', async verticalAlign => {
  const design = migrateV1PresetData({ settings: {
    label: { width: 40, height: 20 },
    logo: { show: false }, qr: { show: false }, info: { show: false }, info2: { show: false },
    title: { template: 'A title that wraps onto several lines', fitToWidth: true, sizeMm: 4 }, title2: { show: false },
  } }, 'spool').design
  const text = design.elements.find(element => element.type === 'text')!
  Object.assign(text, { wrap: true, verticalAlign })
  // Model wrapped content whose height fits at 2 mm, even when parent overflow
  // metrics miss content overflowing above a middle/bottom-aligned box.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.dataset.labelElementType !== 'text') return 40
    const size = Number.parseFloat(this.parentElement.style.fontSize)
    return (size > 2 ? 3 : 2) * size * (96 / 25.4) * 1.15
  })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(node => ({
    lineHeight: String(Number.parseFloat((node as HTMLElement).style.fontSize) * (96 / 25.4) * 1.15),
  } as CSSStyleDeclaration))
  const output = document.createElement('div')
  await renderFreeformLabel({ element: output, design, data: {} as SpoolData })
  const title = output.querySelector<HTMLElement>('[data-label-element-type="text"]')!
  expect(title.style.whiteSpace).toBe('normal')
  expect(Number.parseFloat(title.style.fontSize)).toBeGreaterThan(1.9)
  expect(Number.parseFloat(title.style.fontSize)).toBeLessThanOrEqual(2)
  expect(text.fontSizeMm).toBe(4)
})

it('keeps the minimum font size and blocks output when wrapped text cannot fit in two lines', async () => {
  const design = migrateV1PresetData({ settings: {
    label: { width: 40, height: 20 },
    logo: { show: false }, qr: { show: false }, info: { show: false }, info2: { show: false },
    title: { template: 'Too much text for this box', fitToWidth: true, sizeMm: 4 }, title2: { show: false },
  } }, 'spool').design
  Object.assign(design.elements.find(element => element.type === 'text')!, { wrap: true, minFontSizeMm: 2 })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(node => ({
    lineHeight: String(Number.parseFloat((node as HTMLElement).style.fontSize) * (96 / 25.4) * 1.15),
  } as CSSStyleDeclaration))
  const output = document.createElement('div')
  await renderFreeformLabel({ element: output, design, data: {} as SpoolData })
  expect(output.querySelector<HTMLElement>('[data-label-element-type="text"]')!.style.fontSize).toBe('2mm')
  await expect(waitForLabelOutputAssets([output])).rejects.toThrow('Text cannot fit')
})
