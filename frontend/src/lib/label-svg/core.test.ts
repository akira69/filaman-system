import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { renderSvgLabel, rasterize } from './core.mjs'
import { createSvgRuntime } from './runtime.mjs'
import type { SvgInput, SvgRuntime } from './types'
import { fixtures, data } from '../../../prototypes/svg-label/fixtures.mjs'

let runtime: SvgRuntime
beforeAll(async () => {
  runtime = await createSvgRuntime((path: string) => readFile(`node_modules/${path}`))
})
const input = () => ({ preset: structuredClone(fixtures[0].preset), data, assets: {},
  pixelWidth: 641, pixelHeight: 481, origin: 'https://fila.test', entityPath: 'spools', thermal: false } as unknown as SvgInput)
const render = (value: SvgInput, threshold = 200) => renderSvgLabel(value, runtime, threshold)

it('uses the same fixed-point luminance rounding as Pillow at threshold boundaries', () => {
  const output = rasterize('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="1"><rect width="9" height="1" fill="#02e57f"/></svg>', 150)
  // Pillow RGB(2, 229, 127) -> L=150; equality is white, not black.
  expect([...output.mono]).toEqual([0, 0])
})

it('keeps multiple QR hit boxes and opaque clearance above non-QR artwork', () => {
  const value = input()
  value.thermal = true
  value.preset.design.elements = [
    { id: 'qr-a', type: 'qr', x: 1, y: 1, w: 18, h: 18, z: 0, mode: 'simple' },
    { id: 'qr-b', type: 'qr', x: 21, y: 1, w: 18, h: 18, z: 1, mode: 'logo' },
    { id: 'background', type: 'shape', shape: 'rectangle', x: 0, y: 0, w: 40, h: 30, z: 99, fill: '#000' },
  ] as SvgInput['preset']['design']['elements']
  const result = render(value)
  expect(result.qrs.map((qr: { id: string }) => qr.id)).toEqual(['qr-a', 'qr-b'])
  expect(result.boxes).toHaveLength(3)
  for (const qr of result.qrs) {
    const index = (qr.y! * result.width + qr.x!) * 4
    expect(Array.from(result.pixels.slice(index, index + 4))).toEqual([255, 255, 255, 255])
    expect(qr.dots).toBeGreaterThanOrEqual(3)
  }
})

it('honors explicit output dimensions and threshold endpoints without mutating the design', () => {
  const value = input(), before = structuredClone(value)
  const result = render(value, 0)
  expect([result.width, result.height]).toEqual([641, 481])
  expect(result.mono).toHaveLength(81 * 481)
  expect(result.mono.every((byte: number) => byte === 0)).toBe(true)
  expect(render(value, 255).mono.some((byte: number) => byte !== 0)).toBe(true)
  expect(value).toEqual(before)
  expect(() => render({ ...value, pixelWidth: 0 })).toThrow(/dimension|pixel/i)
  expect(() => render({ ...value, pixelWidth: 8001, pixelHeight: 1000 })).toThrow(/pixel/i)
})

it('returns collapsed geometry for editor hit targets, including hidden rows', () => {
  const value = input()
  value.preset.design.elements = [
    { id: 'logo', type: 'manufacturerLogo', x: 1, y: 1, w: 38, h: 4, collapseWhenEmpty: true },
    { id: 'title', type: 'text', x: 1, y: 5.5, w: 38, h: 3, template: '[if={missing}]gone[/if]', fontSizeMm: 3, legacyTextRole: 'title' },
    { id: 'info', type: 'text', x: 1, y: 9, w: 18, h: 19, template: 'Ü', fontSizeMm: 2, legacyTextRole: 'info' },
  ] as SvgInput['preset']['design']['elements']
  const result = render(value)
  expect(result.boxes.find((box: { id: string }) => box.id === 'logo').hidden).toBe(true)
  expect(result.boxes.find((box: { id: string }) => box.id === 'title').hidden).toBe(true)
  expect(result.boxes.find((box: { id: string }) => box.id === 'info')).toMatchObject({ y: 1.5, hidden: false })
})
