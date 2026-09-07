/**
 * Label template parser for the Advanced Label Designer.
 *
 * Template syntax:
 *   {token}                — simple dot-path substitution; resolves to "?" if missing
 *   {token|date}           — date-only rendering for date/datetime tokens
 *   {prefix{token}suffix}  — optional block: rendered as prefix+value+suffix if token is not "?"
 *                            omitted entirely when token resolves to "?"
 *   **bold**               — <strong> text
 *   *italic*               — <em> text (single asterisk, not part of **)
 *   __underline__          — <u> text
 *   ^^caps^^               — uppercase text
 *   ==inverse==            — inverted text (black bg, white text)
 *   @@inverse@@            — inverted text using filament color with automatic black/white text
 *   [size=120]text[/size]  — inline relative size in percent (50..300)
 *   [size=120%]text[/size] — same as above; percent sign is optional
 *   {color_swatch[8]}      — inline color bar using filament color(s); width is in ch units (default 1)
 *                            8-digit colors use their visible RGB portion.
 *   \n                     — line-break (<br>)
 *
 * SpoolData is a flat object passed from the print page; the "extra" key holds
 * extra-field values keyed by field key.
 */

import { formatDateDisplay } from './extra-fields'
import { toOpaqueRgbHex } from './colors'

export interface SpoolData {
  id: string | number
  // ── Filament profile fields ───────────────────────────────────────────────
  'filament.id': string
  'filament.name': string
  /** @deprecated compatibility alias for filament.type */
  'filament.material': string
  'filament.color': string
  'filament.colors': string
  'filament.color_hex': string
  'filament.color_hexes': string
  'filament.manufacturer': string
  'filament.manufacturer_id': string
  'filament.color_mode': string
  'filament.multi_color_style': string
  'filament.extruder_temp': string | number
  'filament.bed_temp': string | number
  'filament.raw_material_weight_g': string | number
  /** @deprecated compatibility alias for filament.raw_material_weight_g */
  'filament.weight': string | number
  'filament.type'?: string
  'filament.subtype'?: string
  'filament.manufacturer_color_name'?: string
  'filament.diameter'?: string
  'filament.finish'?: string
  'filament.density'?: string
  'filament.price'?: string
  'filament.default_spool_weight_g'?: string
  'filament.spool_outer_diameter_mm'?: string
  'filament.spool_width_mm'?: string
  'filament.spool_material'?: string
  'filament.shop_url'?: string
  // ── Spool model fields (only populated on spool print pages) ─────────────
  lot_number?: string
  external_id?: string
  rfid_uid?: string
  location?: string
  status?: string
  purchase_date?: string
  purchase_price?: string
  remaining_weight_g?: string
  initial_total_weight_g?: string
  empty_spool_weight_g?: string
  spool_core_weight_g?: string
  low_weight_threshold_g?: string
  stocked_in_at?: string
  last_used_at?: string
  created_at?: string
  extra?: Record<string, string>
  /** Unformatted values used by token modifiers such as |date. */
  extraRaw?: Record<string, unknown>
  [key: string]: unknown
}

type FilamentSwatchMode = 'bands' | 'layers'

const SWATCH_MARKER_RE = /^\[\[FM_SWATCH\|(\d{1,3})\|(bands|layers)\|((?:#[0-9A-F]{6})(?:,#[0-9A-F]{6})*)\]\]$/
const MAX_TEMPLATE_CHARS = 8000
const MAX_MARKUP_CHARS = 12000

export function normalizeHexColor(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const hex = toOpaqueRgbHex(String(raw), '')
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : null
}

export function getFilamentSwatchColors(colorHexes: unknown, fallbackHex?: unknown): string[] {
  const candidates = String(colorHexes ?? '')
    .split(',')
    .map(part => normalizeHexColor(part))
    .filter((hex): hex is string => Boolean(hex))
  if (candidates.length > 0) return [...new Set(candidates)]
  const fallback = normalizeHexColor(fallbackHex)
  return fallback ? [fallback] : []
}

export function getFilamentSwatchMode(style: unknown): FilamentSwatchMode {
  const normalized = String(style ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  if (normalized === 'gradient' || normalized === 'layered' || normalized === 'layers' || normalized === 'layer') return 'layers'
  return 'bands'
}

export function buildFilamentSwatchBackground(colors: string[], style: unknown): string {
  if (colors.length === 0) return ''
  if (colors.length === 1) return colors[0]

  const stops: string[] = []
  const direction = getFilamentSwatchMode(style) === 'layers' ? '180deg' : '90deg'
  colors.forEach((color, index) => {
    const start = (index / colors.length) * 100
    const end = ((index + 1) / colors.length) * 100
    stops.push(`${color} ${start.toFixed(3)}% ${end.toFixed(3)}%`)
  })
  return `linear-gradient(${direction}, ${stops.join(', ')})`
}

export function getReadableTextColor(backgroundHex: string | null): '#000' | '#fff' {
  if (!backgroundHex) return '#fff'
  const hex = backgroundHex.replace('#', '')
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const linear = rgb.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
  const contrastWithBlack = (luminance + 0.05) / 0.05
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  return contrastWithBlack >= contrastWithWhite ? '#000' : '#fff'
}

export function getReadableTextColorForColors(colors: string[]): '#000' | '#fff' {
  if (colors.length === 0) return '#fff'
  const totals = colors.reduce<[number, number, number]>((sum, color) => {
    const hex = color.replace('#', '')
    return [
      sum[0] + Number.parseInt(hex.slice(0, 2), 16),
      sum[1] + Number.parseInt(hex.slice(2, 4), 16),
      sum[2] + Number.parseInt(hex.slice(4, 6), 16),
    ]
  }, [0, 0, 0])
  const averageHex = totals
    .map(total => Math.round(total / colors.length).toString(16).padStart(2, '0'))
    .join('')
  return getReadableTextColor(`#${averageHex}`)
}

export function getFilamentColorTheme(data: SpoolData): { background: string; foreground: '#000' | '#fff' } {
  const colors = getFilamentSwatchColors(data['filament.color_hexes'], data['filament.color_hex'])
  const fallback = '#000000'
  return {
    background: buildFilamentSwatchBackground(colors, data['filament.multi_color_style']) || fallback,
    foreground: colors.length > 0 ? getReadableTextColorForColors(colors) : getReadableTextColor(fallback),
  }
}

function parseColorSwatchToken(token: string): number | null {
  const m = token.trim().match(/^color(?:-|_)swatch(?:\[(\d{1,3})\])?$/i)
  if (!m) return null
  const width = m[1] ? Number(m[1]) : 1
  return Math.max(1, Math.min(40, width))
}

function renderColorSwatchMarker(token: string, data: SpoolData): string | null {
  const widthCh = parseColorSwatchToken(token)
  if (widthCh === null) return null
  const colors = getFilamentSwatchColors(data['filament.color_hexes'], data['filament.color_hex'])
  if (colors.length === 0) return ''
  return `[[FM_SWATCH|${widthCh}|${getFilamentSwatchMode(data['filament.multi_color_style'])}|${colors.join(',')}]]`
}

interface TemplateCharacterSource {
  start: number
  end: number
  atomic?: boolean
}

function splitDateModifier(token: string): { key: string; dateOnly: boolean } {
  const match = token.trim().match(/^(.*?)\|date$/i)
  return match
    ? { key: match[1].trim(), dateOnly: true }
    : { key: token.trim(), dateOnly: false }
}

function readTokenValue(
  tokenKey: string,
  data: SpoolData,
): { value: unknown; rawValue: unknown } {
  if (tokenKey.startsWith('extra.')) {
    const key = tokenKey.slice(6)
    const value = data.extra?.[key]
    return {
      value,
      rawValue: data.extraRaw?.[key] ?? value,
    }
  }
  const value = (data as Record<string, unknown>)[tokenKey]
  return { value, rawValue: value }
}

/** Resolve a dot-path token against the spool data object. */
function resolveToken(token: string, data: SpoolData): string {
  const literalKey = token.trim()
  let { value, rawValue } = readTokenValue(literalKey, data)
  let dateOnly = false
  if (value === undefined) {
    const modified = splitDateModifier(literalKey)
    if (modified.dateOnly) {
      ;({ value, rawValue } = readTokenValue(modified.key, data))
      dateOnly = true
    }
  }
  if (value === undefined || value === null || value === '') return '?'
  return dateOnly ? formatDateDisplay(rawValue) : String(value)
}

/** Expand {token} and {prefix{token}suffix} placeholders to plain text. */
export function renderTemplateText(template: string, data: SpoolData): string {
  return expandTemplate(template, data, false).text
}

/** Track UTF-16 offsets alongside expansion, before markup hides its delimiters. */
function expandTemplate(template: string, data: SpoolData, selectable: boolean): {
  text: string
  sources?: TemplateCharacterSource[]
} {
  const boundedTemplate = template.length > MAX_TEMPLATE_CHARS
    ? template.slice(0, MAX_TEMPLATE_CHARS)
    : template
  const sources: TemplateCharacterSource[] | undefined = selectable ? [] : undefined
  const appendLiteralSources = (text: string, start: number) => {
    if (sources) for (let i = 0; i < text.length; i++) sources.push({ start: start + i, end: start + i + 1 })
  }
  const appendTokenSources = (text: string, start: number, end: number) => {
    if (sources) for (let i = 0; i < text.length; i++) sources.push({ start, end, atomic: true })
  }
  let last = 0
  // Match both optional-block {{inner}} style and simple {token}
  // Process longest matches first (optional blocks) before simple tokens.
  const rendered = boundedTemplate.replace(
    /{(?:[^{}]|{[^{}]*})*}/g,
    (match, offset: number) => {
      appendLiteralSources(boundedTemplate.slice(last, offset), last)
      last = offset + match.length
      // Optional block: {prefix{token}suffix}
      const optional = match.match(/^\{(.*?)\{([^{}]+)\}(.*?)\}$/)
      if (optional) {
        const [, prefix, token, suffix] = optional
        const swatchMarker = renderColorSwatchMarker(token, data)
        const resolved = swatchMarker ?? resolveToken(token, data)
        if (resolved === '?' || resolved === '') return ''
        appendLiteralSources(prefix, offset + 1)
        const tokenStart = offset + 1 + prefix.length
        appendTokenSources(resolved, tokenStart, tokenStart + token.length + 2)
        appendLiteralSources(suffix, tokenStart + token.length + 2)
        return prefix + resolved + suffix
      }
      // Simple token: {token}
      const token = match.slice(1, -1)
      const swatchMarker = renderColorSwatchMarker(token, data)
      const resolved = swatchMarker ?? resolveToken(token, data)
      const value = resolved === '?' ? '' : resolved
      appendTokenSources(value, offset, offset + match.length)
      return value
    }
  )
  // Caps runs after token resolution so wrapped tokens uppercase their values,
  // without forcing fields like color_hex to be uppercase by default.
  appendLiteralSources(boundedTemplate.slice(last), last)
  let capsLast = 0
  const capsSources: TemplateCharacterSource[] | undefined = selectable ? [] : undefined
  const text = rendered.replace(/\^\^([\s\S]*?)\^\^/g, (match, inner: string, offset: number) => {
    if (sources && capsSources) {
      capsSources.push(...sources.slice(capsLast, offset))
      let innerOffset = offset + 2
      for (const character of inner) {
        const source = sources[innerOffset]
        const endSource = sources[innerOffset + character.length - 1]
        const upper = character.toUpperCase()
        for (let i = 0; i < upper.length; i++) capsSources.push({ ...source, end: endSource.end, atomic: source.atomic || upper.length !== 1 || character.length !== 1 })
        innerOffset += character.length
      }
      capsLast = offset + match.length
    }
    return inner.toUpperCase()
  })
  if (sources && capsSources) capsSources.push(...sources.slice(capsLast))
  return { text, sources: capsSources }
}

/** Apply inline markup to rendered template text. */
function applyMarkup(text: string, frag: DocumentFragment | HTMLElement, data: SpoolData, sources?: TemplateCharacterSource[], sourceOffset = 0): void {
  // Regex: match swatch marker, [size=NNN]...[/size] (case-insensitive),
  // bold (**...**), underline (__...__), italic (*...*), inverse (==...==), filament inverse (@@...@@)
  const regex = /(\[\[FM_SWATCH\|\d{1,3}\|(bands|layers)\|(?:#[0-9A-F]{6})(?:,#[0-9A-F]{6})*\]\]|\[size=\d{1,3}%?\][\s\S]*?\[\/size\]|\*\*\*[\s\S]*?\*\*\*|\*\*[\s\S]*?\*\*|__[\s\S]*?__|\*(?!\*)([\s\S]*?)\*(?!\*)|==[\s\S]*?==|@@[\s\S]*?@@)/gi
  let last = 0

  const appendPlainText = (raw: string, container: DocumentFragment | HTMLElement, offset: number) => {
    if (sources) {
      let cursor = 0
      while (cursor < raw.length) {
        const source = sources[sourceOffset + offset + cursor]
        let end = cursor + 1
        while (end < raw.length && raw[end] !== '\n' && raw[cursor] !== '\n') {
          const next = sources[sourceOffset + offset + end]
          if (source.atomic ? !next.atomic || source.start !== next.start || source.end !== next.end : next.atomic || next.start !== source.start + end - cursor || next.end !== next.start + 1) break
          end++
        }
        const el = document.createElement(raw[cursor] === '\n' ? 'br' : 'span')
        el.dataset.templateStart = String(source.start)
        el.dataset.templateEnd = String(sources[sourceOffset + offset + end - 1].end)
        if (source.atomic) el.dataset.templateAtomic = 'true'
        if (raw[cursor] !== '\n') {
          el.dataset.templateLeaf = 'true'
          el.textContent = raw.slice(cursor, end)
        }
        container.append(el)
        cursor = end
      }
      return
    }
    // Split on newlines and insert <br>
    const lines = raw.split('\n')
    lines.forEach((line, i) => {
      if (line) container.appendChild(document.createTextNode(line))
      if (i < lines.length - 1) container.appendChild(document.createElement('br'))
    })
  }

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > last) {
      appendPlainText(text.slice(last, match.index), frag, last)
    }

    const part = match[0]

    const swatch = part.match(SWATCH_MARKER_RE)
    if (swatch) {
      const [, widthCh, mode, rawColors] = swatch
      const el = document.createElement('span')
      el.style.display = 'inline-block'
      el.style.width = `${Number(widthCh)}ch`
      el.style.height = '0.82em'
      el.style.background = buildFilamentSwatchBackground(rawColors.split(','), mode)
      el.style.borderRadius = '0.14em'
      el.style.border = '1px solid rgba(0,0,0,0.28)'
      el.style.verticalAlign = 'baseline'
      el.style.margin = '0 0.2ch'
      if (sources) {
        el.dataset.templateStart = String(sources[sourceOffset + match.index].start)
        el.dataset.templateEnd = String(sources[sourceOffset + match.index + part.length - 1].end)
        el.dataset.templateAtomic = 'true'
      }
      frag.appendChild(el)
    } else if (/^\[size=/i.test(part) && /\[\/size\]$/i.test(part)) {
      const sized = part.match(/^\[size=(\d{1,3})%?\]([\s\S]*?)\[\/size\]$/i)
      if (sized) {
        const [, rawPct, inner] = sized
        const pct = Math.max(50, Math.min(300, Number(rawPct)))
        const el = document.createElement('span')
        el.style.fontSize = `${pct}%`
        applyMarkup(inner, el, data, sources, sourceOffset + match.index + part.indexOf(']') + 1)
        frag.appendChild(el)
      } else {
        appendPlainText(part, frag, match.index)
      }
    } else if (part.startsWith('***') && part.endsWith('***')) {
      const strong = document.createElement('strong')
      const emphasis = document.createElement('em')
      applyMarkup(part.slice(3, -3), emphasis, data, sources, sourceOffset + match.index + 3)
      strong.append(emphasis)
      frag.append(strong)
    } else if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2)
      const el = document.createElement('strong')
      applyMarkup(inner, el, data, sources, sourceOffset + match.index + 2)
      frag.appendChild(el)
    } else if (part.startsWith('__') && part.endsWith('__')) {
      const inner = part.slice(2, -2)
      const el = document.createElement('u')
      applyMarkup(inner, el, data, sources, sourceOffset + match.index + 2)
      frag.appendChild(el)
    } else if (part.startsWith('==') && part.endsWith('==')) {
      const inner = part.slice(2, -2)
      const el = document.createElement('span')
      el.style.backgroundColor = '#000'
      el.style.color = '#fff'
      el.style.padding = '0 0.6mm'
      el.style.display = 'inline-block'
      applyMarkup(inner, el, data, sources, sourceOffset + match.index + 2)
      frag.appendChild(el)
    } else if (part.startsWith('@@') && part.endsWith('@@')) {
      const inner = part.slice(2, -2)
      const theme = getFilamentColorTheme(data)
      const el = document.createElement('span')
      el.style.background = theme.background
      el.style.color = theme.foreground
      el.style.padding = '0 0.6mm'
      el.style.display = 'inline-block'
      applyMarkup(inner, el, data, sources, sourceOffset + match.index + 2)
      frag.appendChild(el)
    } else if (part.startsWith('*') && part.endsWith('*')) {
      const inner = part.slice(1, -1)
      const el = document.createElement('em')
      applyMarkup(inner, el, data, sources, sourceOffset + match.index + 1)
      frag.appendChild(el)
    }

    last = match.index + part.length
  }

  // Remaining text after last match
  if (last < text.length) {
    appendPlainText(text.slice(last), frag, last)
  }
}

/**
 * Parse a template string with spool data and return a DocumentFragment
 * ready to append into the DOM.
 */
export function parseTemplate(template: string, data: SpoolData): DocumentFragment {
  const plainText = renderTemplateText(template, data)
  const frag = document.createDocumentFragment()
  if (plainText.length > MAX_MARKUP_CHARS) {
    frag.appendChild(document.createTextNode(plainText.slice(0, MAX_MARKUP_CHARS)))
    return frag
  }
  applyMarkup(plainText, frag, data)
  return frag
}

/** Same renderer as parseTemplate, with source annotations for canvas text selection. */
export function renderSelectableTemplate(template: string, data: SpoolData): DocumentFragment {
  const { text, sources } = expandTemplate(template, data, true)
  const frag = document.createDocumentFragment()
  if (text.length > MAX_MARKUP_CHARS) {
    // Match the regular renderer's bounded plain-text fallback exactly.
    for (let i = 0; i < MAX_MARKUP_CHARS;) {
      const source = sources![i]
      let end = i + 1
      while (end < MAX_MARKUP_CHARS) {
        const next = sources![end]
        if (source.atomic ? !next.atomic || next.start !== source.start || next.end !== source.end : next.atomic || next.start !== source.start + end - i || next.end !== next.start + 1) break
        end++
      }
      const span = document.createElement('span')
      span.dataset.templateStart = String(source.start)
      span.dataset.templateEnd = String(sources![end - 1].end)
      span.dataset.templateLeaf = 'true'
      if (source.atomic) span.dataset.templateAtomic = 'true'
      span.textContent = text.slice(i, end)
      frag.append(span)
      i = end
    }
  } else {
    applyMarkup(text, frag, data, sources)
  }
  return frag
}
