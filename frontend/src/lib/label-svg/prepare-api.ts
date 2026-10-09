import type { ApiLabelRenderPayload } from '../label-api-render'
import { buildSpoolDataFromApiSpool } from '../label-designer-data'
import { normalizeDesignerPresetData } from '../freeform-label/migrate-v1'
import { API_DEFAULT_LABEL_SETTINGS, apiDefaultExtraFields } from '../label-standard'
import type { SvgAsset, SvgInput } from './types'

export function prepareSvgApiInput(payload: ApiLabelRenderPayload, origin: string, assets: Record<string, SvgAsset>): SvgInput {
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid renderer origin')
  const data = buildSpoolDataFromApiSpool(payload.spool, undefined, payload.fieldDefinitions)
  const defaults = API_DEFAULT_LABEL_SETTINGS
  // Reuse the migration boundary; Default is request-local, never a saved/selected preset.
  const preset = normalizeDesignerPresetData(payload.preset ?? { version: 1, settings: {
    label: { width: defaults.widthMm, height: defaults.heightMm, marginMm: 2 },
    logo: { show: defaults.showLogo, spaceMm: 5 },
    title: { template: '{filament.name}', sizeMm: 4, fitToWidth: true },
    qr: { show: defaults.showQR, sizeMm: defaults.qrSizeMm },
    info: { template: ['ID: {id}', '{filament.manufacturer}', '{filament.type}', '{filament.color}',
      ...apiDefaultExtraFields(data.remaining_weight_g).map(field => `${field.label}: {remaining_weight_g} g`)].join('\n') },
  } }, 'spool')
  const embedded: Record<string, SvgAsset> = {}
  for (const [id, path] of Object.entries(payload.assets)) if (assets[path]) embedded[id] = assets[path]
  if (payload.logoUrl && assets[payload.logoUrl]) embedded.logo = assets[payload.logoUrl]
  if (assets.qrLogo) embedded.qrLogo = assets.qrLogo
  return { preset, data, assets: embedded, origin: url.origin, entityPath: 'spools',
    pixelWidth: payload.pixelWidth, pixelHeight: payload.pixelHeight, thermal: !!payload.thermal }
}
