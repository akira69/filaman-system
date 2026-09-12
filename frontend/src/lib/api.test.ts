import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchAllPages } from './api'

afterEach(() => vi.restoreAllMocks())

describe('fetchAllPages', () => {
  it('rejects instead of returning partial data when a later page fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [1], total: 201 }) })
      .mockResolvedValueOnce({ ok: false }))

    await expect(fetchAllPages<number>('/things')).rejects.toThrow('Failed to fetch /things')
  })
})
