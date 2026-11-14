import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { VERSION } from '../src/version.js'

const origin = new URL(process.argv[2] || 'http://127.0.0.1:4321').origin
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  const requests = []
  const problemSpools = []
  let sessionExpired = false
  let showOtherPlugin = true
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.text().startsWith('Could not initialize panel:')) errors.push(message.text())
  })
  await page.addInitScript(({ version, forceFallback }) => {
    localStorage.setItem('changelog-seen-version', version)
    localStorage.setItem('lang', 'de')
    localStorage.setItem('theme', 'dark')
    if (forceFallback) Object.defineProperty(document, 'startViewTransition', { value: undefined })
  }, { version: VERSION, forceFallback: process.env.FORCE_ASTRO_SWAP === '1' })

  const user = { id: 1, display_name: 'Preview', language: 'de', is_superadmin: true, permissions: [], roles: [] }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    requests.push(url.pathname)
    if (url.pathname === '/api/v1/plugin-nav' && requests.filter(path => path === url.pathname).length === 1) {
      return route.fulfill({ status: 503 })
    }
    if (url.pathname.startsWith('/plugin-page/')) return route.fulfill({ contentType: 'text/html', body: '<title>Example plugin</title>' })
    if (url.pathname === '/plugins/native-example/') return route.fulfill({ contentType: 'text/html', body: '<title>Native plugin</title>' })
    if (!/^\/(api|auth)\//.test(url.pathname)) return route.continue()
    if (sessionExpired && url.pathname === '/api/v1/me') return route.fulfill({ status: 401 })
    if (url.pathname === '/api/v1/spools' && url.searchParams.get('low_or_empty') === 'true') {
      problemSpools.push(url)
      return route.fulfill({ json: {
        total: 1,
        items: [{ id: 3, remaining_weight_g: 50, filament: { designation: 'Sample PLA', material_type: 'PLA' } }],
      } })
    }
    const data = {
      '/api/v1/me': user,
      '/auth/me': user,
      '/api/v1/me/preferences': { dashboard_hidden_widgets: [] },
      '/api/v1/app-settings/public-info': { currency: 'EUR' },
      '/api/v1/plugin-nav': [
        { name: 'Example', page_url: '/plugin-page/example' },
        ...(showOtherPlugin ? [{ name: 'Other', page_url: '/plugin-page/other' }] : []),
        { name: 'Native', page_url: '/plugin-view/native-example' },
        { name: 'FilamentDB', page_url: '/admin/system/filamentdb-import' },
      ],
      '/api/v1/display': { printers: [] },
      '/api/v1/spools/statuses': [],
      '/api/v1/spools/filter-options': { used_status_ids: [], by_status: {} },
      '/api/v1/filaments/filter-options': { manufacturers: [], types: [], colors: [] },
      '/api/v1/system-extra-fields': [],
      '/api/v1/devices/active': [],
      '/api/v1/filamentdb/status': { active: true },
      '/api/v1/tag/readers': [],
      '/api/v1/dashboard/stats': {
        spool_count_total: 2, filament_count_total: 1, filament_count_active: 1, filament_count_used: 1,
        spool_distribution: { full: 1, normal: 0, low: 1, critical: 0, empty: 0 },
        total_value_available: 3, filament_stats: [], location_stats: [], manufacturers_with_spools: [], low_stock_spools: [],
      },
      '/api/v1/labels/print-requests/pending': null,
    }
    if (url.pathname === '/api/v1/events/stream') return route.fulfill({ status: 204 })
    await route.fulfill({ json: url.pathname in data ? data[url.pathname] : { items: [], total: 0, page: 1 } })
  })

  const sidebar = page.locator('.fm-sidebar')
  const clickNav = async path => {
    const before = await page.locator('main').elementHandle()
    await sidebar.locator(`a[href="${path}"]:visible`).click()
    const target = new URL(path, origin)
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '') && url.search === target.search)
    await sidebar.locator(`a[href="${path}"].active`).waitFor()
    assert.equal(await page.evaluate(() => window.sidebarBefore === document.querySelector('.fm-sidebar')), true)
    assert.equal(await before.evaluate(main => main.isConnected), false)
    await before.dispose()
    await page.locator('main').waitFor()
    await page.locator('.astro-route-announcer').waitFor({ state: 'attached' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    assert.equal(await page.locator('html').getAttribute('lang'), 'de')
  }
  await page.goto(origin)
  await sidebar.waitFor()
  await page.waitForFunction(() => document.getElementById('stat-total-spools')?.textContent === '2')
  assert.equal(requests.some(path => path === '/api/v1/spools' || path === '/api/v1/filaments'), false)
  await page.locator('#problem-spools').click()
  await page.locator('#spool-modal a[href="/spools/3"]').first().waitFor()
  assert.equal(problemSpools.length, 1)
  await page.locator('#spool-modal [data-dialog-close]').click()
  await page.evaluate(() => { window.sidebarBefore = document.querySelector('.fm-sidebar') })
  await clickNav('/spools')
  const search = page.locator('#filter-search')
  const searchFor = async term => {
    const request = page.waitForRequest(req => new URL(req.url()).searchParams.get('search') === term)
    await search.fill(term)
    await request
  }
  await searchFor('blue')
  await clickNav('/filaments')
  await page.goBack()
  await page.waitForURL(/\/spools/)
  await sidebar.locator('a[href="/spools"].active').waitFor()
  await page.locator('.astro-route-announcer').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => window.sidebarBefore === document.querySelector('.fm-sidebar')), true)
  await searchFor('red')
  await page.goBack()
  await page.waitForURL(origin + '/')
  await page.goForward()
  await page.waitForURL(/\/spools/)
  await sidebar.locator('a[href="/spools"].active').waitFor()
  await page.waitForFunction(() => document.querySelector('#filter-search')?.value === 'red')
  for (const path of ['/manufacturers', '/locations', '/printers', '/settings', '/admin', '/admin/system/filamentdb-import']) {
    await clickNav(path)
    if (path === '/settings') {
      const toggle = page.locator('#show-color-library')
      const track = page.locator('.fm-toggle:has(#show-color-library)')
      await track.click()
      assert.equal(await toggle.isChecked(), false)
      assert.equal(await sidebar.locator('#sidebar-color-library').getAttribute('hidden'), '')
      assert.equal(await page.evaluate(() => localStorage.getItem('sidebar-color-library')), 'false')
      await track.click()
      assert.equal(await toggle.isChecked(), true)
      await sidebar.locator('#sidebar-color-library').waitFor()
    }
  }

  await clickNav('/filaments/colors')
  await clickNav('/display')
  await page.locator('#ams-printers .ams-note').waitFor()
  await clickNav('/plugin-view?p=example')
  await page.locator('#plugin-frame[src="/plugin-page/example"]').waitFor()
  await clickNav('/plugin-view?p=other')
  await page.locator('#plugin-frame[src="/plugin-page/other"]').waitFor()
  showOtherPlugin = false
  await clickNav('/plugin-view/native-example')
  await page.locator('#plugin-iframe[src^="/plugins/native-example/"]').waitFor()
  await sidebar.locator('a[href="/plugin-view?p=other"]').waitFor({ state: 'detached' })
  const displayRequests = requests.filter(path => path === '/api/v1/display').length
  await page.setViewportSize({ width: 390, height: 850 })
  await page.locator('#sidebar-toggle[aria-expanded="false"]').click()
  await sidebar.locator('a[href="/spool-log"]').click()
  await page.waitForURL(origin + '/spool-log')
  assert.equal(await page.evaluate(() => window.sidebarBefore === document.querySelector('.fm-sidebar')), true)
  await page.locator('#sidebar-toggle[aria-expanded="false"]').waitFor()
  assert.equal(await page.locator('main').evaluate(main => main.inert), false)
  assert.ok(requests.filter(path => path === '/api/v1/plugin-nav').length > 2)
  await page.waitForTimeout(5100)
  assert.equal(requests.filter(path => path === '/api/v1/display').length, displayRequests)
  await page.locator('#sidebar-toggle[aria-expanded="false"]').click()
  sessionExpired = true
  await sidebar.locator('a[href="/spools"]').click()
  await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('next') === '/spools')
  assert.deepEqual(errors, [])
  console.log('Sidebar persists through navigation and Back. Filters, plugin panels, mobile focus and polling cleanup work.')
} finally {
  await browser.close()
}
