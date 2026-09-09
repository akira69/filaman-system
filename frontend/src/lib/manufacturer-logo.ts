export interface ManufacturerLogoLike {
  name?: string | null
  logo_file?: string | null
  logo_url?: string | null
  resolved_logo_url?: string | null
}

interface RenderManufacturerLogoOptions {
  size?: number
  width?: number
  height?: number
  borderRadius?: string
  previewUrl?: string | null
  tooltipText?: string | null
  flexibleWidth?: boolean
  multilineFallback?: boolean
  withPill?: boolean
  pillWidth?: number | string
  pillPadding?: string
  pillBorderRadius?: string
  pillJustify?: 'flex-start' | 'center' | 'flex-end'
}

export function escapeHtml(value: string | number | null | undefined): string {
  const div = document.createElement('div')
  div.textContent = value == null ? '' : String(value)
  return div.innerHTML
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function getManufacturerLogoUrl(manufacturer?: ManufacturerLogoLike | null): string | null {
  return normalizeOptionalString(manufacturer?.logo_url) ?? normalizeOptionalString(manufacturer?.resolved_logo_url)
}

export function renderManufacturerLogo(
  manufacturer?: ManufacturerLogoLike | null,
  options: RenderManufacturerLogoOptions = {},
): string {
  const size = options.size ?? 40
  const width = options.width ?? size
  const height = options.height ?? size
  const borderRadius = options.borderRadius ?? '10px'
  const previewUrl = normalizeOptionalString(options.previewUrl)
  const tooltipText = normalizeOptionalString(options.tooltipText)
  const flexibleWidth = options.flexibleWidth ?? false
  const multilineFallback = options.multilineFallback ?? false
  const withPill = options.withPill ?? false
  const pillWidth = options.pillWidth
  const pillPadding = options.pillPadding ?? '4px 10px'
  const pillBorderRadius = options.pillBorderRadius ?? '8px'
  const pillJustify = options.pillJustify ?? (multilineFallback ? 'flex-end' : 'center')
  const imageUrl = previewUrl ?? getManufacturerLogoUrl(manufacturer)
  const altText = escapeHtml(`${manufacturer?.name || 'Manufacturer'} logo`)
  const fallbackText = escapeHtml(manufacturer?.name?.trim() || 'Logo')
  const fallbackFontSize = multilineFallback
    ? Math.max(11, Math.floor(Math.min(width / 10, height * 0.32)))
    : Math.max(12, Math.floor(Math.min(width, height) * 0.34))
  const titleAttr = tooltipText ? ` title="${escapeHtml(tooltipText)}"` : ''
  const pillWidthStyle = typeof pillWidth === 'number'
    ? `width: ${pillWidth}px;`
    : pillWidth
      ? `width: ${pillWidth};`
      : ''

  const wrapWithPill = (content: string) => {
    if (!withPill) return content
    return `<div${titleAttr} style="display: inline-flex; align-items: center; justify-content: ${pillJustify}; max-width: 100%; ${pillWidthStyle} min-height: ${height + 8}px; padding: ${pillPadding}; border-radius: ${pillBorderRadius}; background: color-mix(in srgb, white 30%, var(--bg-soft) 70%); border: 1px solid color-mix(in srgb, white 22%, var(--border) 78%); box-sizing: border-box;">${content}</div>`
  }

  if (imageUrl) {
    const widthStyle = flexibleWidth ? `max-width: ${width}px; width: auto;` : `width: ${width}px;`
    return wrapWithPill(`<img src="${escapeHtml(imageUrl)}" alt="${altText}"${titleAttr} style="${widthStyle} height: ${height}px; object-fit: contain; border-radius: ${borderRadius}; flex-shrink: 0; min-width: 0;" />`)
  }

  const fallbackLayout = multilineFallback
    ? `max-width: ${width}px; width: ${width}px; line-height: 1.05; text-align: right; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;`
    : `width: ${width}px; white-space: nowrap; text-overflow: ellipsis;`

  return wrapWithPill(`<div aria-hidden="true" style="${fallbackLayout} height: ${height}px; overflow: hidden; color: #111827; font-size: ${fallbackFontSize}px; font-weight: 600; font-family: var(--font-serif); letter-spacing: 0.03em; font-style: italic; flex-shrink: 0; display: flex; align-items: center; justify-content: ${multilineFallback ? 'flex-end' : 'center'};">${fallbackText}</div>`)
}
