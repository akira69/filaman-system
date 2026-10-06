import { buildSpoolDataFromApiSpool, renderDesignerLabel } from './label-designer'
import { captureLabelElement } from './label-export'
import { normalizeDesignerPresetData } from './freeform-label/migrate-v1'
import { API_DEFAULT_LABEL_SETTINGS, apiDefaultExtraFields, buildStandardLabelDataFromApiSpool, renderStandardLabel } from './label-standard'
import type { SpoolExtraFieldDefinitionMap } from './spool-label-data'
import { waitForLabelOutputAssets } from './label-output-readiness'
import { renderThermalQrs } from './qr-code'

export interface ApiLabelRenderPayload {
  spool: unknown
  preset: unknown | null
  fieldDefinitions: SpoolExtraFieldDefinitionMap
  logoUrl?: string | null
  assets: Record<string, string>
  pixelWidth: number
  pixelHeight: number
  thermal?: boolean
}

/** Shared label rendering; mono1 leaves a dot-sized surface for CDP capture. */
export async function renderApiLabel(payload: ApiLabelRenderPayload): Promise<string | { x: number; y: number; width: number; height: number }> {
  const element = document.createElement('div')
  element.className = 'label-preview'
  document.body.appendChild(element)
  let captureRoot = element
  let awaitingScreenshot = false
  try {
    const data = buildSpoolDataFromApiSpool(payload.spool, undefined, payload.fieldDefinitions)
    if (payload.preset !== null) {
      await renderDesignerLabel({
        thermalQr: payload.thermal,
        element,
        design: normalizeDesignerPresetData(payload.preset, 'spool').design,
        data,
        logoUrl: payload.logoUrl,
        resolveAssetUrl: id => Object.hasOwn(payload.assets, id) ? payload.assets[id] : null,
        previewBorder: false,
      })
    } else {
      await renderStandardLabel({
        thermalQr: payload.thermal,
        element,
        data: buildStandardLabelDataFromApiSpool(payload.spool, apiDefaultExtraFields(data.remaining_weight_g)),
        settings: API_DEFAULT_LABEL_SETTINGS,
        logoUrl: payload.logoUrl,
      })
    }
    if (payload.thermal) {
      await waitForLabelOutputAssets([element])
      const rect = element.getBoundingClientRect()
      const scaleX = payload.pixelWidth / rect.width
      const scaleY = payload.pixelHeight / rect.height
      // An integer-sized wrapper avoids html-to-image's rounded CSS dimensions.
      captureRoot = document.createElement('div')
      Object.assign(captureRoot.style, {
        width: `${payload.pixelWidth}px`, height: `${payload.pixelHeight}px`,
        position: 'relative', overflow: 'hidden', background: '#fff',
      })
      element.before(captureRoot)
      captureRoot.appendChild(element)
      element.style.transformOrigin = '0 0'
      element.style.transform = `scale(${scaleX}, ${scaleY})`
      renderThermalQrs(element, scaleX, scaleY)
      await waitForLabelOutputAssets([captureRoot])
      const { x, y, width, height } = captureRoot.getBoundingClientRect()
      awaitingScreenshot = true
      return { x, y, width, height }
    }
    return await captureLabelElement(captureRoot, {
      pixelRatio: 1, canvasWidth: payload.pixelWidth, canvasHeight: payload.pixelHeight,
    })
  } finally {
    if (!awaitingScreenshot) captureRoot.remove()
  }
}
