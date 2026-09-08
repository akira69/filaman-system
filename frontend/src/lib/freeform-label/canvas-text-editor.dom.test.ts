// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { bindCanvasTextEditor } from './canvas-text-editor'
import { createDefaultLabelDesign } from './defaults'
import { renderSelectableTemplate } from './template-selection'
import type { SpoolData } from '../label-template'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren() })

function editor(source: string, delayed = false) {
  const selected = createDefaultLabelDesign('spool').elements.find(element => element.type === 'text')!
  selected.template = source
  document.body.innerHTML = '<div id="freeform-canvas-host"><div data-label-element-id="text" data-label-element-type="text"></div></div><div id="freeform-text-toolbar"><button data-text-modifier="bold">B</button><button data-text-modifier="underline">U</button></div>'
  selected.id = 'text'
  const node = document.querySelector<HTMLElement>('[data-label-element-id]')!
  const render = () => { node.replaceChildren(renderSelectableTemplate(selected.template, { 'filament.color': 'Ocean Blue' } as SpoolData)) }
  render()
  let range = { start: 0, end: 0 }
  const refreshes: Array<() => void> = []
  const binding = bindCanvasTextEditor({
    root: document, getSelected: () => selected, getTemplateRange: () => range,
    resetTemplateRange: () => { range = { start: 0, end: 0 } }, isEditable: () => true,
    select: () => {}, updateTemplate: (value, nextRange) => { selected.template = value; range = nextRange },
    refresh: () => delayed ? new Promise<void>(resolve => { refreshes.push(() => { render(); resolve() }) }) : Promise.resolve(render()), refreshInteractions: async () => {},
  })
  cleanups.push(binding.destroy)
  binding.sync()
  node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  function select(start: Node, startOffset: number, end = start, endOffset = startOffset) {
    const range = document.createRange()
    range.setStart(start, startOffset); range.setEnd(end, endOffset)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  }
  function input(inputType: string, data: string | null = null) {
    node.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }))
  }
  function clipboard(type: string, contents: Record<string, string> = {}) {
    const transfer = new DataTransfer()
    Object.entries(contents).forEach(([key, value]) => transfer.setData(key, value))
    const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: transfer })
    node.dispatchEvent(event)
    return transfer
  }
  return { selected, node, select, input, clipboard, binding, flush: (reverse = false) => {
    const pending = refreshes.splice(0)
    ;(reverse ? pending.reverse() : pending).forEach(refresh => refresh())
  } }
}

describe('canvas text editing', () => {
  it('edits visible literal text while keeping resolved tokens indivisible', async () => {
    const e = editor('Hi {filament.color}')
    expect(e.node.contentEditable).toBe('true')
    expect(e.node.querySelector<HTMLElement>('[data-template-token-chip]')!.title).toBe('{filament.color}')
    expect(e.node.querySelector<HTMLElement>('[data-template-atomic]')!.contentEditable).toBe('false')
    e.select(e.node.firstChild!.firstChild!, 1)
    e.input('insertText', 'ey')
    await Promise.resolve()
    expect(e.selected.template).toBe('Heyi {filament.color}')
    expect(document.getSelection()!.isCollapsed).toBe(true)
    expect(document.getSelection()!.anchorOffset).toBe(3)
  })

  it('replaces a partial token highlight as a complete token', () => {
    const e = editor('Hi {filament.color}!')
    const token = e.node.querySelector('[data-template-atomic]')!
    e.select(token.firstChild!, 2, token.firstChild!, 5)
    e.input('insertText', 'blue')
    expect(e.selected.template).toBe('Hi blue!')
  })

  it('backspaces an entire token beside a caret', () => {
    const e = editor('Hi {filament.color}!')
    const tail = e.node.lastChild!.firstChild!
    e.select(tail, 0)
    e.input('deleteContentBackward')
    expect(e.selected.template).toBe('Hi !')
  })

  it('copies source tokens with enclosing formatting and pastes them without HTML', async () => {
    const e = editor('**Hi {filament.color}**!')
    const token = e.node.querySelector('[data-template-atomic]')!
    e.select(token.firstChild!, 2, token.firstChild!, 5)
    const copied = e.clipboard('copy')
    expect(copied.getData('text/plain')).toBe('**{filament.color}**')
    e.select(e.node.lastChild!.firstChild!, 1)
    e.clipboard('paste', { 'text/plain': copied.getData('text/plain'), 'text/html': '<img src=x onerror="alert(1)">' })
    await Promise.resolve()
    expect(e.selected.template).toBe('**Hi {filament.color}**!**{filament.color}**')
    expect(e.node.querySelector('img')).toBeNull()
  })

  it('deletes across formatting boundaries without leaving markup or removing unselected letters', () => {
    const e = editor('**Hello** world')
    const leaves = e.node.querySelectorAll('[data-template-leaf]')
    e.select(leaves[0].firstChild!, 2, leaves[1].firstChild!, 3)
    e.input('deleteContentForward')
    expect(e.selected.template).toBe('**He**rld')
  })

  it('commits composed input once and keeps tokens intact', async () => {
    const e = editor('Hi {filament.color}')
    e.select(e.node.firstChild!.firstChild!, 3)
    e.node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    e.input('insertCompositionText', 'n')
    e.input('insertCompositionText', 'ñ')
    expect(e.selected.template).toBe('Hi {filament.color}')
    const end = new CompositionEvent('compositionend', { bubbles: true })
    Object.defineProperty(end, 'data', { value: 'ñ' }) // happy-dom does not implement CompositionEvent.data.
    e.node.dispatchEvent(end)
    await Promise.resolve()
    expect(e.selected.template).toBe('Hi ñ{filament.color}')
  })

  it('selects a token chip as a whole on click', () => {
    const e = editor('Hi {filament.color}')
    e.node.querySelector('[data-template-atomic]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.getSelection()!.toString()).toBe('Ocean Blue')
  })

  it('keeps a rapid run of edits and restores its latest caret', async () => {
    const e = editor('Hi ')
    e.select(e.node.firstChild!.firstChild!, 3)
    e.input('insertText', 'a'); e.input('insertText', 'b'); e.input('insertText', 'c')
    await Promise.resolve()
    expect(e.selected.template).toBe('Hi abc')
    expect(document.getSelection()!.anchorOffset).toBe(6)
  })

  it('restores the active caret after an undo rerenders the text', async () => {
    const e = editor('Hi ')
    e.select(e.node.firstChild!.firstChild!, 3)
    e.input('insertText', 'a')
    await Promise.resolve()
    e.selected.template = 'Hi '
    e.node.replaceChildren(renderSelectableTemplate('Hi ', {} as SpoolData))
    e.binding.sync()
    expect(document.getSelection()!.anchorNode).toBe(e.node.firstChild!.firstChild)
    expect(document.getSelection()!.anchorOffset).toBe(3)
  })

  it('keeps uppercase-expanded literal characters editable without token chips', () => {
    const e = editor('^^Straße^^ {filament.color}')
    const expanded = [...e.node.querySelectorAll<HTMLElement>('[data-template-atomic]')].find(node => node.textContent === 'SS')!
    expect(expanded.contentEditable).not.toBe('false')
    expect(expanded.hasAttribute('data-template-token-chip')).toBe(false)
  })

  it('deletes the latest typed character when rendering has not caught up', async () => {
    const e = editor('Hi {filament.color}', true)
    e.select(e.node, e.node.childNodes.length)
    e.input('insertText', 'abc')
    e.input('deleteContentBackward')
    expect(e.selected.template).toBe('Hi {filament.color}ab')
    e.flush()
    await Promise.resolve()
    expect(document.getSelection()!.anchorOffset).toBe(2)
  })

  it('inserts a dock token at the visible caret', async () => {
    const e = editor('Hi there')
    e.select(e.node.firstChild!.firstChild!, 3)
    expect(e.binding.insertField('{filament.color}')).toBe(true)
    await Promise.resolve()
    expect(e.selected.template).toBe('Hi {filament.color}there')
  })

  it('preserves copied bold text when pasted inside existing bold text', async () => {
    const e = editor('**Hello**')
    e.select(e.node.querySelector('[data-template-leaf]')!.firstChild!, 2)
    e.clipboard('paste', { 'text/plain': '**X**' })
    await Promise.resolve()
    expect(e.node.textContent).toBe('HeXllo')
    expect([...e.node.querySelectorAll('strong')].map(node => node.textContent).join('')).toBe('HeXllo')
  })

  it('removes empty markup after deleting the last styled character', async () => {
    const e = editor('**X**')
    e.select(e.node.querySelector('[data-template-leaf]')!.firstChild!, 1)
    e.input('deleteContentBackward')
    await Promise.resolve()
    expect(e.selected.template).toBe('')
    expect(e.node.textContent).toBe('')
  })

  it('keeps the latest edit caret when an older formatting refresh finishes later', async () => {
    const e = editor('Hello', true)
    e.select(e.node.firstChild!.firstChild!, 0, e.node.firstChild!.firstChild!, 5)
    e.binding.format('bold')
    e.input('insertText', 'X')
    e.flush(true)
    await Promise.resolve()
    expect(e.selected.template).toBe('**X**')
    expect(document.getSelection()!.isCollapsed).toBe(true)
    expect(document.getSelection()!.anchorOffset).toBe(1)
  })

  it('rejects oversized paste without truncating tokens or existing source', () => {
    const e = editor('Hi {filament.color}')
    e.select(e.node, e.node.childNodes.length)
    e.clipboard('paste', { 'text/plain': 'X'.repeat(8001) })
    expect(e.selected.template).toBe('Hi {filament.color}')
  })
})

it('tracks the selected nested style and toggles it with toolbar clicks', async () => {
  const e = editor('**__{filament.color}__** plain')
  const bold = document.querySelector<HTMLButtonElement>('[data-text-modifier="bold"]')!
  e.node.querySelector('[data-template-atomic]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  document.dispatchEvent(new Event('selectionchange'))
  expect(bold.getAttribute('aria-pressed')).toBe('true')
  for (let i = 0; i < 4; i++) {
    bold.click()
    await Promise.resolve()
    expect(bold.getAttribute('aria-pressed')).toBe(String(i % 2 !== 0))
    expect(e.node.textContent).toBe('Ocean Blue plain')
  }
  const tail = e.node.lastChild!.firstChild!
  e.select(tail, 1, tail, 4)
  document.dispatchEvent(new Event('selectionchange'))
  expect(bold.getAttribute('aria-pressed')).toBe('false')
})
