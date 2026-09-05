import { ApiError, getCsrfToken } from '../api'
import type { LabelAssetClient, LabelAssetMetadata } from './editor-controller'

const ASSET_PATH = '/api/v1/me/label-assets'

type AssetResponse = Omit<LabelAssetMetadata, 'content_url'>

function withContentUrl(asset: AssetResponse): LabelAssetMetadata {
  return {
    ...asset,
    content_url: `${ASSET_PATH}/${encodeURIComponent(asset.id)}/content`,
  }
}

async function expectResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  const body = await response.json().catch(() => null) as {
    detail?: { code?: string; message?: string } | string
  } | null
  const detail = body?.detail
  const code = typeof detail === 'object' && detail?.code
    ? detail.code
    : 'label_asset_error'
  const message = typeof detail === 'object' && detail?.message
    ? detail.message
    : typeof detail === 'string'
      ? detail
      : `HTTP ${response.status}`
  throw new ApiError(response.status, code, message)
}

function mutationHeaders(): Record<string, string> {
  const csrfToken = getCsrfToken()
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
}

export function createLabelAssetClient(): LabelAssetClient {
  return {
    async list() {
      const response = await fetch(ASSET_PATH, {
        credentials: 'include',
      })
      return (await expectResponse<AssetResponse[]>(response)).map(withContentUrl)
    },
    async upload(file) {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(ASSET_PATH, {
        method: 'POST',
        body,
        credentials: 'include',
        headers: mutationHeaders(),
      })
      return withContentUrl(await expectResponse<AssetResponse>(response))
    },
    async delete(assetId) {
      const response = await fetch(`${ASSET_PATH}/${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: mutationHeaders(),
      })
      await expectResponse<void>(response)
    },
  }
}

export function labelAssetContentUrl(assetId: string) {
  return `${ASSET_PATH}/${encodeURIComponent(assetId)}/content`
}
