// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { parseTemplate, type SpoolData } from '../label-template'
import { formatTemplateRange, isTemplateModifierActive, getTemplateSelectionRange, renderSelectableTemplate, restoreTemplateSelection } from './template-selection'

const data = { id: '42', 'filament.color': 'Ocean Blue', 'filament.name': 'Straße', purchase_date: '2026-09-05T12:00:00Z' } as SpoolData
function render(template: string) {
  const root = document.createElement('div')
  root.append(renderSelectableTemplate(template, data))
  return root
}

describe('selectable template rendering', () => {
  it.each([
    'Print {filament.color} now',
    '**Color: __{filament.color}__**\n*Sample*',
    '***{filament.color}***',
    '^^{filament.name} & Straße^^',
    '{Color: {filament.color}!} {Missing {extra.nope}}',
    '[size=120]@@{filament.color}@@[/size] ==42==',
    '{purchase_date|date}',
  ])('preserves parser text and formatting for %s', template => {
    const expected = document.createElement('div')
    expected.append(parseTemplate(template, data))
    const actual = render(template)
    actual.querySelectorAll('[data-template-start]').forEach(span => {
      if (span.hasAttribute('data-template-leaf')) span.replaceWith(...span.childNodes)
      else [...span.attributes].filter(attr => attr.name.startsWith('data-template-')).forEach(attr => span.removeAttribute(attr.name))
    })
    expect(actual.innerHTML).toBe(expected.innerHTML)
  })

  it('expands a partial rendered token selection to its complete source token', () => {
    const root = render('Print {filament.color} now')
    const token = root.querySelector('[data-template-atomic]')!
    const selection = document.createRange()
    selection.setStart(token.firstChild!, 2)
    selection.setEnd(token.firstChild!, 7)
    expect(getTemplateSelectionRange(root, selection)).toEqual({ start: 6, end: 22 })
  })

  it('maps literal substrings and mixed selections through nested markup', () => {
    const root = render('**Print {filament.color} now**')
    const spans = root.querySelectorAll('[data-template-leaf]')
    const selection = document.createRange()
    selection.setStart(spans[0].firstChild!, 2)
    selection.setEnd(spans[1].firstChild!, 3)
    expect(getTemplateSelectionRange(root, selection)).toEqual({ start: 4, end: 24 })
    selection.setEnd(spans[0].firstChild!, 4)
    expect(getTemplateSelectionRange(root, selection)).toEqual({ start: 4, end: 6 })
  })

  it('maps literal uppercase expansions to their original character', () => {
    const root = render('^^Straße^^')
    const selection = document.createRange()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent?.includes('SS')) node = walker.nextNode()
    selection.setStart(node!, node!.textContent!.indexOf('SS'))
    selection.setEnd(node!, node!.textContent!.indexOf('SS') + 1)
    expect(getTemplateSelectionRange(root, selection)).toEqual({ start: 6, end: 7 })
  })

  it('rejects selections outside the text element and collapsed carets', () => {
    const root = render('Hello')
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(true)
    expect(getTemplateSelectionRange(root, range)).toBeNull()
    range.selectNodeContents(document.createElement('div'))
    expect(getTemplateSelectionRange(root, range)).toBeNull()
  })

  it('restores a mapped selection after rerendering', () => {
    const root = render('**{filament.color}**')
    document.body.append(root)
    const selection = window.getSelection()!
    expect(restoreTemplateSelection(root, { start: 2, end: 18 }, selection)).toBe(true)
    expect(selection.toString()).toBe('Ocean Blue')
    expect(getTemplateSelectionRange(root, selection)).toEqual({ start: 2, end: 18 })
    root.remove()
  })

  it('keeps original source offsets after omitted conditionals and line breaks', () => {
    const root = render('{Missing {extra.nope}}\nHi {filament.color}')
    const token = root.querySelector('[data-template-atomic]')!
    const range = document.createRange()
    range.selectNodeContents(token)
    expect(root.textContent).toBe('Hi Ocean Blue')
    expect(root.querySelectorAll('br')).toHaveLength(1)
    expect(getTemplateSelectionRange(root, range)).toEqual({ start: 26, end: 42 })
  })

  it('annotates a color swatch as one atomic token without changing its drawing', () => {
    const template = '{color_swatch[8]}'
    const swatchData = { ...data, 'filament.color_hex': '#00AAFF' }
    const root = document.createElement('div')
    root.append(renderSelectableTemplate(template, swatchData))
    const swatch = root.querySelector<HTMLElement>('[data-template-atomic]')!
    const range = document.createRange()
    range.selectNode(swatch)
    expect(getTemplateSelectionRange(root, range)).toEqual({ start: 0, end: 17 })
    expect(swatch.style.width).toBe('8ch')
    expect(swatch.style.background).toBe('#00AAFF')
  })

  it('preserves bounded plain-text fallback for oversized resolved values', () => {
    const longData = { ...data, 'filament.color': '**' + 'X'.repeat(12001) + '**' }
    const root = document.createElement('div')
    root.append(renderSelectableTemplate('{filament.color}', longData))
    expect(root.textContent).toBe('**' + 'X'.repeat(11998))
    expect(root.querySelector('strong')).toBeNull()
    const range = document.createRange()
    range.selectNodeContents(root.firstChild!)
    expect(getTemplateSelectionRange(root, range)).toEqual({ start: 0, end: 16 })
  })
})

describe('source range formatting', () => {
  it('formats only selected literal characters', () => {
    expect(formatTemplateRange('Hello world', 1, 4, 'bold')).toEqual({ template: 'H**ell**o world', start: 3, end: 6 })
  })
  it('protects tokens even if supplied offsets fall inside token syntax', () => {
    expect(formatTemplateRange('A {filament.color} Z', 5, 9, 'italic')).toEqual({ template: 'A *{filament.color}* Z', start: 3, end: 19 })
  })
  it('toggles the same selected wrapper without leaving markup characters', () => {
    expect(formatTemplateRange('A **{filament.color}** Z', 4, 20, 'bold')).toEqual({ template: 'A {filament.color} Z', start: 2, end: 18 })
  })
  it('supports combined nested styles and whole-element formatting', () => {
    expect(formatTemplateRange('**{filament.color}**', 2, 18, 'underline').template).toBe('**__{filament.color}__**')
    expect(formatTemplateRange('A {filament.color}', 0, 18, 'inverse').template).toBe('==A {filament.color}==')
  })
  it('renders combined bold and italic and independently toggles either style', () => {
    const result = formatTemplateRange('**{filament.color}**', 2, 18, 'italic')
    expect(result.template).toBe('***{filament.color}***')
    const fragment = parseTemplate(result.template, data)
    expect(fragment.textContent).toBe('Ocean Blue')
    expect(fragment.querySelector('strong em')?.textContent).toBe('Ocean Blue')
    expect(formatTemplateRange(result.template, 3, 19, 'bold').template).toBe('*{filament.color}*')
    expect(formatTemplateRange(result.template, 3, 19, 'italic').template).toBe('**{filament.color}**')
  })
  it('keeps conditional blocks valid when formatting token or crossing their boundary', () => {
    expect(formatTemplateRange('{Color: {filament.color}!} tail', 8, 24, 'bold').template).toBe('{Color: **{filament.color}**!} tail')
    expect(formatTemplateRange('{Color: {filament.color}!} tail', 10, 29, 'bold').template).toBe('**{Color: {filament.color}!} ta**il')
  })
  it('expands crossing a formatting boundary so delimiters remain paired', () => {
    expect(formatTemplateRange('**Hello** world', 4, 12, 'underline').template).toBe('__**Hello** wo__rld')
  })
  it('removes a repeated style from a literal substring while keeping its neighbors styled', () => {
    const result = formatTemplateRange('**Hello**', 3, 6, 'bold')
    expect(result).toEqual({ template: '**H**ell**o**', start: 5, end: 8 })
    const fragment = parseTemplate(result.template, data)
    expect(fragment.textContent).toBe('Hello')
    expect([...fragment.querySelectorAll('strong')].map(element => element.textContent)).toEqual(['H', 'o'])
  })
  it('toggles date on complete selected tokens without changing literal text', () => {
    const result = formatTemplateRange('On {purchase_date} today', 0, 24, 'date')
    expect(result.template).toBe('On {purchase_date|date} today')
    expect(formatTemplateRange(result.template, result.start, result.end, 'date').template).toBe('On {purchase_date} today')
    expect(formatTemplateRange('Hello world', 0, 11, 'date').template).toBe('Hello world')
  })
})


describe('selection formatting state', () => {
  it('toggles enclosing styles through nested markup without accumulating delimiters', () => {
    let source = '**__{filament.color}__**'
    for (let i = 0; i < 6; i++) {
      const start = source.indexOf('{')
      const end = source.indexOf('}') + 1
      expect(isTemplateModifierActive(source, start, end, 'bold')).toBe(i % 2 === 0)
      expect(isTemplateModifierActive(source, start, end, 'underline')).toBe(true)
      source = formatTemplateRange(source, start, end, 'bold').template
      expect(render(source).textContent).toBe('Ocean Blue')
      expect(source.length).toBeLessThanOrEqual(24)
    }
  })
  it('turns mixed formatting on uniformly and then off', () => {
    const source = '**Hello** world'
    expect(isTemplateModifierActive(source, 2, source.length, 'bold')).toBe(false)
    const on = formatTemplateRange(source, 2, source.length, 'bold')
    expect(on.template).toBe('**Hello world**')
    expect(isTemplateModifierActive(on.template, on.start, on.end, 'bold')).toBe(true)
    expect(formatTemplateRange(on.template, on.start, on.end, 'bold').template).toBe('Hello world')
  })
  it('removes bold from part of combined bold/italic while retaining italic', () => {
    const result = formatTemplateRange('***Hello***', 4, 7, 'bold')
    const root = render(result.template)
    expect(root.textContent).toBe('Hello')
    expect([...root.querySelectorAll('strong')].map(node => node.textContent).join('')).toBe('Ho')
    expect([...root.querySelectorAll('em')].map(node => node.textContent).join('')).toBe('Hello')
    expect(isTemplateModifierActive(result.template, result.start, result.end, 'bold')).toBe(false)
  })
})
