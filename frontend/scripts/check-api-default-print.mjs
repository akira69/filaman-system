/** Seeded smoke test against the built Astro app; no real print job is sent. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4397'
const server = spawn(process.execPath, ['dist/server/entry.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: '4397' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', data => { output += data })
server.stderr.on('data', data => { output += data })
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH, headless: true })
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* server starting */ }
    if (attempt > 100 || server.exitCode !== null) throw new Error(output)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  context.setDefaultTimeout(15000)
  let pending = { id: 18, spool_id: 73, preset_id: null }
  await context.route(`${origin}/api/**`, async route => {
    const path = new URL(route.request().url()).pathname
    let json = []
    if (path.endsWith('/pending')) json = pending
    else if (path.endsWith('/claim')) { pending = null; return route.fulfill({ status: 204 }) }
    else if (path.endsWith('/me')) json = { id: 1, username: 'Reviewer', display_name: 'Reviewer', email: 'review@example.test', language: 'en', roles: ['Admin'], is_superuser: true, is_superadmin: true, permissions: ['*'] }
    else if (path.endsWith('/auth/status')) json = { authenticated: true, setup_required: false }
    else if (path.endsWith('/spools/73')) json = { id: 73, remaining_weight_g: 850, initial_total_weight_g: 1000,
      filament: { id: 3, designation: 'Aurora PLA', material_type: 'PLA', diameter_mm: 1.75,
        manufacturer: { id: 2, name: 'FilaWorks' }, manufacturer_color_name: 'Ocean',
        filament_colors: [{ color: { name: 'Ocean', hex_code: '#0088cc' }, position: 1 }] },
      status: { label: 'Active' }, custom_fields: { private: 'do not print' } }
    else if (path.includes('label-logo')) return route.fulfill({ status: 404 })
    return route.fulfill({ json })
  })
  const saved = JSON.stringify({ width: '100', height: '50', fontSize: '100', qrSize: '12', showQR: false,
    showLogo: true, showID: true, showMfr: true, showMat: true, showColor: true,
    showColorSwatch: true, showColorHex: true, extraFields: { private: true } })
  await context.addInitScript(value => {
    if (!localStorage.getItem('filaman-label-settings')) localStorage.setItem('filaman-label-settings', value)
  }, saved)
  const page = await context.newPage()
  page.on('pageerror', error => console.error(error.message))
  await page.goto(`${origin}/spools`)
  await page.locator('#pc-print-prompt').waitFor({ state: 'visible' })
  const [request] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.pc-print-prompt-open').click(),
  ])
  await request.waitForLoadState()
  await request.waitForFunction(() => document.querySelector('#label-preview')?.style.width)
  assert.equal(await request.locator('#input-width').inputValue(), '60')
  assert.equal(await request.locator('#input-height').inputValue(), '40')
  assert.equal(await request.locator('#check-qr').isChecked(), true)
  assert.match(await request.locator('.label-extra-fields').innerText(), /Remaining:\s*850 g/)
  assert.equal(await request.evaluate(() => localStorage.getItem('filaman-label-settings')), saved)
  await request.locator('#input-width').fill('65')
  await request.locator('#input-width').dispatchEvent('change')
  await request.waitForFunction(() => document.querySelector('#label-preview').style.width === '65mm')
  assert.equal(await request.evaluate(() => localStorage.getItem('filaman-label-settings')), saved)
  await request.locator('#btn-reset').click()
  await request.waitForFunction(() => document.querySelector('#label-preview').style.width === '60mm')
  assert.equal(await request.evaluate(() => localStorage.getItem('filaman-label-settings')), saved)
  if (process.env.LABEL_EVIDENCE_DIR) await request.screenshot({ path: `${process.env.LABEL_EVIDENCE_DIR}/default-request.png` })
  await request.evaluate(() => { window.print = () => { window.printCalled = true } })
  await request.locator('#check-print-pdf').uncheck()
  await request.locator('#btn-print').click()
  await request.waitForFunction(() => window.printCalled)
  assert.equal(await request.locator('#filaman-label-print-host button, #filaman-label-print-host input, #filaman-label-print-host [data-label-editor-chrome]').count(), 0)
  await request.emulateMedia({ media: 'print' })
  assert.equal(await request.locator('#filaman-label-print-host').isVisible(), true)
  assert.equal(await request.locator('#btn-print').isVisible(), false)
  if (process.env.LABEL_EVIDENCE_DIR) await request.pdf({ path: `${process.env.LABEL_EVIDENCE_DIR}/default-print.pdf`, preferCSSPageSize: true })
  await request.emulateMedia({ media: 'screen' })
  await request.goto(`${origin}/spools/73/print`)
  await request.waitForFunction(() => document.querySelector('#input-width')?.value === '100')
  assert.equal(await request.locator('#check-qr').isChecked(), false)
  console.log('Default request: popup, API settings, Remaining, local edits/reset and unchanged normal preferences passed')
} finally {
  await browser.close()
  server.kill('SIGTERM')
  if (server.exitCode === null) await once(server, 'exit')
}
