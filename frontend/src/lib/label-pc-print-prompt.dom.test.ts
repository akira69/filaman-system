// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupPcPrintPrompt } from './label-pc-print-prompt'

type Pending = { id: number; spool_id: number; preset_id: number | null }
let pending: Pending | null
let claims: string[]

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  pending = null
  claims = []
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/claim')) {
      claims.push(url)
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify(pending))
  })
})

afterEach(() => {
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

it('opens the latest spool and preset when a legacy server reuses a request ID', async () => {
  pending = { id: 1, spool_id: 17, preset_id: 4 }
  setupPcPrintPrompt()
  await vi.advanceTimersByTimeAsync(0)
  expect(document.querySelector('[role="status"]')?.textContent).toContain('17')

  const button = document.querySelector<HTMLButtonElement>('[role="status"] button')!
  button.focus()
  pending = { id: 1, spool_id: 28, preset_id: 9 }
  await vi.advanceTimersByTimeAsync(3000)
  expect(document.querySelector('[role="status"]')?.textContent).toContain('28')
  expect(document.activeElement).toBe(button)
  const printWindow = { location: { href: 'about:blank' }, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(printWindow as unknown as Window)
  document.querySelector<HTMLButtonElement>('[role="status"] button')!.click()
  await vi.advanceTimersByTimeAsync(0)

  expect(claims).toEqual(['/api/v1/labels/print-requests/1/claim'])
  expect(printWindow.location.href).toBe('/spools/28/print?scale_print=1&preset_id=9')
  expect(document.querySelector('[role="status"]')).toBeNull()
})

it('continues polling after a back-forward cache round trip and stops on unload', async () => {
  setupPcPrintPrompt()
  await vi.advanceTimersByTimeAsync(0)
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
  pending = { id: 2, spool_id: 31, preset_id: null }
  await vi.advanceTimersByTimeAsync(3000)
  expect(document.querySelector('[role="status"]')?.textContent).toContain('31')

  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))
  pending = { id: 3, spool_id: 42, preset_id: null }
  await vi.advanceTimersByTimeAsync(3000)
  expect(document.querySelector('[role="status"]')?.textContent).toContain('31')
})
