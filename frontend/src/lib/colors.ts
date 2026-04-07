export function normalizeHexCode(value?: string | null): string {
  if (!value) return ''

  let raw = String(value).trim().replace(/^#/, '')
  if (!raw) return ''

  if (raw.length === 3 || raw.length === 4) {
    raw = raw
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }

  if (!/^[0-9a-fA-F]+$/.test(raw) || (raw.length !== 6 && raw.length !== 8)) {
    return String(value).trim()
  }

  return `#${raw.toUpperCase()}`
}

export function toOpaqueRgbHex(value?: string | null, fallback = '#000000'): string {
  const normalized = normalizeHexCode(value)
  if (!normalized.startsWith('#')) return fallback

  const raw = normalized.slice(1)
  return raw.length === 8 ? `#${raw.slice(2)}` : normalized
}

export function toCssColor(value?: string | null, fallback = 'transparent'): string {
  const normalized = normalizeHexCode(value)
  if (!normalized.startsWith('#')) return fallback

  const raw = normalized.slice(1)
  if (raw.length === 6) return normalized

  const alpha = Number((parseInt(raw.slice(0, 2), 16) / 255).toFixed(3))
  const red = parseInt(raw.slice(2, 4), 16)
  const green = parseInt(raw.slice(4, 6), 16)
  const blue = parseInt(raw.slice(6, 8), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
