// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from 'vitest'
import { migrateV1PresetData } from './migrate-v1'
import { renderFreeformLabel } from './render'
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
    return this.isConnected ? Number.parseFloat(this.style.fontSize) * 50 : 0
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
