import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { createDefaultLabelDesign } from '../freeform-label/defaults'

const input = () => ({ payload: { spool: { id: 295, filament: { designation: 'Grüße ÄÖÜ ß', type: 'PLA' } },
  preset: { version: 2, design: createDefaultLabelDesign('spool') }, fieldDefinitions: { spool: {}, filament: {} },
  assets: {}, pixelWidth: 480, pixelHeight: 320, thermal: false }, origin: 'https://fila.test', assets: {} })
const run = (value: unknown) => {
  const result = spawnSync(process.env.LABEL_NODE_EXECUTABLE || process.execPath, ['dist/label-svg/render.mjs'],
    { input: typeof value === 'string' ? value : JSON.stringify(value), encoding: 'utf8', timeout: 30000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}
it('runs the built renderer without Vite and returns an exact-size PNG', () => {
  const png = Buffer.from(run(input()).png, 'base64')
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([480, 320])
  expect(run({ ...input(), payload: { ...input().payload, preset: null } }).png).toBeTruthy()
})
it('reports malformed JSON, missing images and overflow explicitly', () => {
  expect(run('{').error.kind).toBe('layout')
  const value = input()
  value.payload.preset.design.elements = [{ id: 'photo', type: 'image', assetId: 'missing', x: 1, y: 1, w: 10, h: 10, z: 0, objectFit: 'contain' }]
  expect(run(value).error).toMatchObject({ kind: 'layout', message: expect.stringMatching(/image/i) })
  value.payload.preset.design.elements = [{ id: 'tiny', type: 'text', template: 'Too much text', x: 1, y: 1, w: 1, h: 1, z: 0, fontSizeMm: 3, fontFamily: 'Space Grotesk', fontWeight: 400, italic: false, underline: false, align: 'left', color: '#000000', wrap: true }]
  expect(run(value).error).toMatchObject({ kind: 'layout', message: expect.stringMatching(/fit/i) })
})
