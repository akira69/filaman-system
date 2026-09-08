export { renderSelectableTemplate } from '../label-template'
import { TEMPLATE_TEXT_MODIFIER_DELIMITERS, type TemplateTextModifier } from './text-modifiers'
export type { TemplateTextModifier } from './text-modifiers'

export interface TemplateSourceRange { start: number; end: number }
export interface FormattedTemplateRange extends TemplateSourceRange { template: string }

const sourceSelector = '[data-template-start][data-template-end]'

function sourceRange(element: HTMLElement): TemplateSourceRange {
  return { start: Number(element.dataset.templateStart), end: Number(element.dataset.templateEnd) }
}

/** Map a caret to source, snapping positions inside substitutions to a token edge. */
export function getTemplateCaretRange(root: HTMLElement, selection: Selection | null): TemplateSourceRange | null {
  if (!selection?.rangeCount || !selection.isCollapsed || !root.contains(selection.anchorNode)) return null
  const node = selection.anchorNode!
  const offset = selection.anchorOffset
  const leaf = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(sourceSelector)
  if (leaf && root.contains(leaf)) {
    const mapped = sourceRange(leaf)
    const position = leaf.hasAttribute('data-template-atomic')
      ? offset === 0 ? mapped.start : mapped.end
      : Math.min(mapped.end, mapped.start + offset)
    return { start: position, end: position }
  }
  const range = selection.getRangeAt(0)
  let position = 0
  for (const element of root.querySelectorAll<HTMLElement>(sourceSelector)) {
    const boundary = root.ownerDocument.createRange()
    boundary.selectNode(element)
    if (range.compareBoundaryPoints(Range.START_TO_START, boundary) <= 0) {
      position = sourceRange(element).start
      break
    }
    position = sourceRange(element).end
  }
  return { start: position, end: position }
}

/** Resolve browser selection offsets without ever indexing into a substituted token. */
export function getTemplateSelectionRange(root: HTMLElement, selection: Selection | Range | null): TemplateSourceRange | null {
  if (!selection) return null
  const range = 'rangeCount' in selection ? selection.rangeCount ? selection.getRangeAt(0) : null : selection
  if (!range || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  let start = Infinity
  let end = -Infinity
  for (const element of root.querySelectorAll<HTMLElement>(sourceSelector)) {
    if (!range.intersectsNode(element)) continue
    const elementRange = document.createRange()
    elementRange.selectNodeContents(element)
    // intersectsNode includes touching boundaries; discard zero-width contact.
    if (range.compareBoundaryPoints(Range.END_TO_START, elementRange) >= 0 || range.compareBoundaryPoints(Range.START_TO_END, elementRange) <= 0) continue
    const source = sourceRange(element)
    if (!element.hasAttribute('data-template-atomic')) {
      const node = element.firstChild
      const length = element.textContent?.length ?? 0
      if (node?.nodeType === Node.TEXT_NODE && length === source.end - source.start) {
        if (range.startContainer === node) source.start += range.startOffset
        if (range.endContainer === node) source.end = Number(element.dataset.templateStart) + range.endOffset
      }
    }
    start = Math.min(start, source.start)
    end = Math.max(end, source.end)
  }
  return Number.isFinite(start) && end > start ? { start, end } : null
}

/** Restore visible text after the preview DOM has been replaced. */
export function restoreTemplateSelection(root: HTMLElement, source: TemplateSourceRange, selection: Selection | null = root.ownerDocument.defaultView?.getSelection() ?? null): boolean {
  if (!selection) return false
  if (source.start === source.end) {
    const elements = [...root.querySelectorAll<HTMLElement>(sourceSelector)]
    const element = elements.find(element => {
      const mapped = sourceRange(element)
      return mapped.start <= source.start && mapped.end >= source.start
    }) ?? elements.find(element => sourceRange(element).start >= source.start) ?? elements.at(-1)
    const range = root.ownerDocument.createRange()
    if (!element) { range.selectNodeContents(root); range.collapse(false) }
    else {
      const mapped = sourceRange(element)
      if (!element.hasAttribute('data-template-atomic') && element.firstChild?.nodeType === Node.TEXT_NODE) {
        range.setStart(element.firstChild, Math.max(0, Math.min(element.firstChild.textContent?.length ?? 0, source.start - mapped.start)))
      } else if (source.start <= mapped.start) range.setStartBefore(element)
      else range.setStartAfter(element)
      range.collapse(true)
    }
    selection.removeAllRanges(); selection.addRange(range)
    return true
  }
  const leaves = [...root.querySelectorAll<HTMLElement>(sourceSelector)].filter(element => {
    const range = sourceRange(element)
    return range.end > source.start && range.start < source.end
  })
  if (leaves.length === 0) return false
  const first = leaves[0]
  const last = leaves[leaves.length - 1]
  const range = root.ownerDocument.createRange()
  const setBoundary = (element: HTMLElement, isStart: boolean) => {
    const mapped = sourceRange(element)
    const text = element.firstChild
    if (text?.nodeType === Node.TEXT_NODE && !element.hasAttribute('data-template-atomic')) {
      const linear = !element.hasAttribute('data-template-atomic') && text.textContent!.length === mapped.end - mapped.start
      const offset = linear
        ? Math.max(0, Math.min(text.textContent!.length, (isStart ? source.start : source.end) - mapped.start))
        : isStart ? 0 : text.textContent!.length
      if (isStart) range.setStart(text, offset)
      else range.setEnd(text, offset)
    } else if (isStart) range.setStartBefore(element)
    else range.setEndAfter(element)
  }
  setBoundary(first, true)
  setBoundary(last, false)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/** Copy a source slice with clipped, balanced formatting wrappers. */
export function copyTemplateRange(template: string, start: number, end: number): string {
  const ranges = syntaxRanges(template).sort((a, b) => a.start - b.start || b.end - a.end)
  const slice = (from: number, to: number, candidates: SyntaxRange[]): string => {
    let result = ''
    let cursor = from
    for (const range of candidates) {
      if (range.start < cursor || range.end > to) continue
      result += template.slice(Math.max(cursor, start), Math.max(cursor, Math.min(range.start, end)))
      if (range.end > start && range.start < end) {
        if (range.token) result += template.slice(range.start, range.end)
        else {
          const inner = slice(range.innerStart, range.innerEnd, candidates.filter(child => child !== range))
          if (inner) result += template.slice(range.start, range.innerStart) + inner + template.slice(range.innerEnd, range.end)
        }
      }
      cursor = range.end
    }
    return result + template.slice(Math.max(cursor, start), Math.max(cursor, Math.min(to, end)))
  }
  return slice(0, template.length, ranges)
}

/** Edit mapped text while preserving unselected text and balanced markup. */
export function replaceTemplateRange(template: string, start: number, end: number, replacement: string): FormattedTemplateRange {
  const ranges = syntaxRanges(template)
  for (const token of ranges.filter(range => range.token)) {
    if (start === end && start > token.start && start < token.end) start = end = token.end
    else if (end > token.start && start < token.end) { start = Math.min(start, token.start); end = Math.max(end, token.end) }
  }
  // A formatted fragment carries its own wrappers; nesting identical delimiters
  // would close the destination's style instead of preserving the copied style.
  const formattedReplacement = syntaxRanges(replacement).some(range => range.delimiter)
  const container = ranges.filter(range => !formattedReplacement && !range.token && start >= range.innerStart && end <= range.innerEnd)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]
  const from = container?.innerStart ?? 0
  const to = container?.innerEnd ?? template.length
  const inner = template.slice(from, to)
  const prefix = copyTemplateRange(inner, 0, start - from)
  const suffix = copyTemplateRange(inner, end - from, inner.length)
  if (container && !prefix && !replacement && !suffix) return replaceTemplateRange(template, container.start, container.end, '')
  const position = from + prefix.length + replacement.length
  return { template: template.slice(0, from) + prefix + replacement + suffix + template.slice(to), start: position, end: position }
}

/** Adjacent source character/token, independent of an asynchronous preview render. */
export function adjacentTemplateRange(template: string, position: number, backward: boolean): TemplateSourceRange | null {
  const ranges = syntaxRanges(template)
  let index = backward ? position - 1 : position
  while (index >= 0 && index < template.length) {
    const token = ranges.find(range => range.token && index >= range.start && index < range.end)
    if (token) return { start: token.start, end: token.end }
    const delimiter = ranges.find(range => !range.token && (
      (index >= range.start && index < range.innerStart) || (index >= range.innerEnd && index < range.end)
    ))
    if (!delimiter) {
      const segment = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(template)]
        .find(part => part.index <= index && part.index + part.segment.length > index)!
      return { start: segment.index, end: segment.index + segment.segment.length }
    }
    index += backward ? -1 : 1
  }
  return null
}

interface SyntaxRange extends TemplateSourceRange { innerStart: number; innerEnd: number; delimiter?: string; token?: boolean }

/** Match the renderer's supported syntax, including nested wrappers and optional blocks. */
function syntaxRanges(template: string): SyntaxRange[] {
  const ranges: SyntaxRange[] = []
  for (const match of template.matchAll(/\{(?:[^{}]|\{[^{}]*\})*\}/g)) {
    const start = match.index!
    const end = start + match[0].length
    ranges.push({ start, end, innerStart: start + 1, innerEnd: end - 1, token: !match[0].slice(1, -1).includes('{') })
    for (const inner of match[0].slice(1, -1).matchAll(/\{[^{}]*\}/g)) {
      const innerStart = start + 1 + inner.index!
      ranges.push({ start: innerStart, end: innerStart + inner[0].length, innerStart: innerStart + 1, innerEnd: innerStart + inner[0].length - 1, token: true })
    }
  }
  const visitMarkup = (text: string, offset: number) => {
    const regex = /\[size=\d{1,3}%?\][\s\S]*?\[\/size\]|\*\*\*[\s\S]*?\*\*\*|\*\*[\s\S]*?\*\*|__[\s\S]*?__|\*(?!\*)([\s\S]*?)\*(?=\*{3}(?!\*)|[^*]|$)|==[\s\S]*?==|@@[\s\S]*?@@|\^\^[\s\S]*?\^\^/gi
    for (const match of text.matchAll(regex)) {
      const part = match[0]
      const size = /^\[size=/i.test(part)
      const delimiter = size ? part.slice(0, part.indexOf(']') + 1) : part.startsWith('***') ? '***' : part.startsWith('**') ? '**' : part[0] === '*' ? '*' : part.slice(0, 2)
      const start = offset + match.index!
      const end = start + part.length
      const innerStart = start + delimiter.length
      const innerEnd = end - (size ? 7 : delimiter.length)
      ranges.push({ start, end, innerStart, innerEnd, delimiter })
      visitMarkup(text.slice(match.index! + delimiter.length, match.index! + part.length - (size ? 7 : delimiter.length)), innerStart)
    }
  }
  visitMarkup(template, 0)
  return ranges
}

function matchesModifier(range: SyntaxRange, modifier: TemplateTextModifier): boolean {
  return modifier !== 'date' && (range.delimiter === TEMPLATE_TEXT_MODIFIER_DELIMITERS[modifier]
    || ((modifier === 'bold' || modifier === 'italic') && range.delimiter === '***'))
}

/** A mixed selection is off; clicking its button applies the style throughout. */
export function isTemplateModifierActive(template: string, start: number, end: number, modifier: TemplateTextModifier): boolean {
  if (end <= start) return false
  const ranges = syntaxRanges(template)
  if (modifier === 'date') {
    const tokens = ranges.filter(range => range.token && range.end > start && range.start < end)
    return tokens.length > 0 && tokens.every(range => /\|date\s*\}$/i.test(template.slice(range.start, range.end)))
  }
  const styled = ranges.filter(range => matchesModifier(range, modifier))
  if (!styled.some(range => range.innerEnd > start && range.innerStart < end)) return false
  // Ignore syntax while checking that every selected character is styled.
  const covered = [...styled, ...ranges.filter(range => !range.token).flatMap(range => [
    { start: range.start, end: range.innerStart }, { start: range.innerEnd, end: range.end },
  ])].sort((a, b) => a.start - b.start)
  let cursor = start
  for (const range of covered) {
    if (range.start > cursor) break
    cursor = Math.max(cursor, range.end)
    if (cursor >= end) return true
  }
  return false
}

/** Remove this style only, including its half of combined bold/italic. */
function removeModifier(template: string, modifier: TemplateTextModifier): string {
  const edits = syntaxRanges(template).filter(range => matchesModifier(range, modifier)).flatMap(range => {
    const remaining = range.delimiter === '***' ? modifier === 'bold' ? '*' : '**' : ''
    return [
      { start: range.start, end: range.innerStart, remaining },
      { start: range.innerEnd, end: range.end, remaining },
    ]
  }).sort((a, b) => b.start - a.start)
  for (const edit of edits) template = template.slice(0, edit.start) + edit.remaining + template.slice(edit.end)
  return template
}

/** Format a source selection, widening only when needed to keep syntax balanced. */
export function formatTemplateRange(template: string, start: number, end: number, modifier: TemplateTextModifier): FormattedTemplateRange {
  start = Math.max(0, Math.min(template.length, Math.trunc(start)))
  end = Math.max(start, Math.min(template.length, Math.trunc(end)))
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return { template, start, end }
  const ranges = syntaxRanges(template)
  let expanded: boolean
  do {
    expanded = false
    for (const range of ranges) {
      if (end <= range.start || start >= range.end) continue
      const crossesBoundary = start < range.innerStart || end > range.innerEnd
      if (range.token || crossesBoundary) {
        const nextStart = Math.min(start, range.start)
        const nextEnd = Math.max(end, range.end)
        expanded ||= nextStart !== start || nextEnd !== end
        start = nextStart
        end = nextEnd
      }
    }
  } while (expanded)

  if (modifier === 'date') {
    const tokens = ranges.filter(range => range.token && range.start >= start && range.end <= end)
    const remove = tokens.length > 0 && tokens.every(range => /\|date\s*\}$/i.test(template.slice(range.start, range.end)))
    let delta = 0
    for (const token of tokens.sort((a, b) => b.start - a.start)) {
      const original = template.slice(token.start, token.end)
      const replacement = remove ? original.replace(/\|date\s*\}$/i, '}') : /\|date\s*\}$/i.test(original) ? original : `${original.slice(0, -1)}|date}`
      template = template.slice(0, token.start) + replacement + template.slice(token.end)
      delta += replacement.length - original.length
    }
    return { template, start, end: end + delta }
  }

  const delimiter = TEMPLATE_TEXT_MODIFIER_DELIMITERS[modifier]
  const remove = isTemplateModifierActive(template, start, end, modifier)
  const container = ranges.filter(range => matchesModifier(range, modifier) && range.innerStart <= start && range.innerEnd >= end)
    .sort((a, b) => a.start - b.start || b.end - a.end)[0]
  if (remove && container) {
    const inner = template.slice(container.innerStart, container.innerEnd)
    const prefix = copyTemplateRange(inner, 0, start - container.innerStart)
    const suffix = copyTemplateRange(inner, end - container.innerStart, inner.length)
    const selected = copyTemplateRange(template.slice(container.start, container.end), start - container.start, end - container.start)
    const middle = removeModifier(selected, modifier)
    const wrap = (text: string) => text ? container.delimiter + text + container.delimiter : ''
    const before = template.slice(0, container.start) + wrap(prefix)
    return { template: before + middle + wrap(suffix) + template.slice(container.end), start: before.length, end: before.length + middle.length }
  }
  const middle = removeModifier(template.slice(start, end), modifier)
  const replacement = remove ? middle : delimiter + middle + delimiter
  return { template: template.slice(0, start) + replacement + template.slice(end), start: start + (remove ? 0 : delimiter.length), end: start + replacement.length - (remove ? 0 : delimiter.length) }
}
