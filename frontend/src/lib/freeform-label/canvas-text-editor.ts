import type { LabelDesignElement } from './types'
import {
  formatTemplateRange,
  isTemplateModifierActive,
  getTemplateSelectionRange,
  getTemplateCaretRange,
  copyTemplateRange,
  replaceTemplateRange,
  adjacentTemplateRange,
  restoreTemplateSelection,
  type TemplateSourceRange,
  type TemplateTextModifier,
} from './template-selection'

interface CanvasTextEditorOptions {
  root: ParentNode
  getSelected(): LabelDesignElement | null
  getTemplateRange(): TemplateSourceRange
  setTemplateRange?(range: TemplateSourceRange): void
  resetTemplateRange(): void
  isEditable(): boolean
  select(id: string): void
  updateTemplate(template: string, range: TemplateSourceRange): void
  refresh(): Promise<void>
  refreshInteractions(): Promise<void>
}

/** Native visible-text editing; template source stays authoritative. */
export function bindCanvasTextEditor(options: CanvasTextEditorOptions) {
  const canvas = options.root.querySelector<HTMLElement>('#freeform-canvas-host')
  const toolbar = options.root.querySelector<HTMLElement>('#freeform-text-toolbar')
  const template = options.root.querySelector<HTMLTextAreaElement>('#freeform-template')
  let editingId: string | null = null
  let selectedId: string | null = null
  let canvasRange: TemplateSourceRange | null = null
  let destroyed = false
  let gestureActive = false
  let pendingEdit = 0
  let editRevision = 0
  let compositionRange: TemplateSourceRange | null = null
  const cleanups: Array<() => void> = []
  const listen = <E extends Event = Event>(target: EventTarget | null, event: string, handler: (event: E) => void) => {
    target?.addEventListener(event, handler as EventListener)
    cleanups.push(() => target?.removeEventListener(event, handler as EventListener))
  }
  const selectedNode = (id = options.getSelected()?.id) => {
    return Array.from(canvas?.querySelectorAll<HTMLElement>('[data-label-element-id]') ?? [])
      .find(node => node.dataset.labelElementId === id) ?? null
  }

  const sync = () => {
    if (destroyed) return
    const selected = options.getSelected()
    const text = options.isEditable() && selected?.type === 'text' ? selected : null
    const leavingTextSelection = editingId !== null && selectedId !== text?.id
    if (selectedId !== text?.id) {
      editingId = null
      canvasRange = null
      compositionRange = null
      pendingEdit = 0
      editRevision++
      selectedId = text?.id ?? null
    }
    if (!text) editingId = null
    for (const node of canvas?.querySelectorAll<HTMLElement>('[data-label-element-id]') ?? []) {
      const editing = node.dataset.labelElementId === editingId
      node.toggleAttribute('data-label-text-editing', editing)
      if (editing) node.contentEditable = 'true'
      else node.removeAttribute('contenteditable')
      for (const token of node.querySelectorAll<HTMLElement>('[data-template-atomic]')) {
        const source = text?.template.slice(Number(token.dataset.templateStart), Number(token.dataset.templateEnd)) ?? ''
        const chip = editing && /^\{[^{}]*\}$/.test(source)
        token.toggleAttribute('data-template-token-chip', chip)
        if (chip) { token.contentEditable = 'false'; token.draggable = false; token.title = source }
        else { token.removeAttribute('contenteditable'); token.removeAttribute('draggable'); token.removeAttribute('title') }
      }
      if (editing && canvasRange && !pendingEdit && !compositionRange && !node.contains(document.getSelection()?.anchorNode ?? null)) {
        restoreTemplateSelection(node, canvasRange)
      }
    }
    if (leavingTextSelection) void options.refreshInteractions()
    toolbar?.querySelector('[data-text-select]')?.setAttribute('aria-pressed', String(editingId !== null))
    syncModifierState()
    positionToolbar()
  }

  const positionToolbar = () => {
    if (destroyed || !toolbar) return
    const selected = options.getSelected()
    const node = selectedNode(selected?.id)
    toolbar.hidden = gestureActive || !options.isEditable() || !selected || !node
    toolbar.style.left = ''
    toolbar.style.top = ''
  }

  const syncModifierState = () => {
    const selected = options.getSelected()
    const source = canvasRange ?? options.getTemplateRange()
    const range = source.end > source.start ? source : { start: 0, end: selected?.type === 'text' ? selected.template.length : 0 }
    toolbar?.querySelectorAll<HTMLButtonElement>('[data-text-modifier]').forEach(button => {
      button.setAttribute('aria-pressed', String(selected?.type === 'text' && isTemplateModifierActive(
        selected.template, range.start, range.end, button.dataset.textModifier as TemplateTextModifier,
      )))
    })
  }

  const rememberCanvasRange = () => {
    if (!editingId || pendingEdit || compositionRange) return
    const node = selectedNode()
    const selection = document.getSelection()
    if (!node || !selection || !node.contains(selection.anchorNode)) return
    canvasRange = getTemplateSelectionRange(node, selection) ?? getTemplateCaretRange(node, selection)
    if (canvasRange) options.setTemplateRange?.(canvasRange)
    syncModifierState()
    if (canvasRange && !selection.isCollapsed) {
      const range = selection.getRangeAt(0)
      const atomicBoundary = [range.startContainer, range.endContainer].some(node =>
        (node instanceof Element ? node : node.parentElement)?.closest('[data-template-atomic]'))
      if (atomicBoundary) restoreTemplateSelection(node, canvasRange)
    }
  }

  const startSelecting = (id: string) => {
    if (!options.isEditable()) return
    options.select(id)
    sync()
    if (options.getSelected()?.type !== 'text') return
    editingId = id
    canvasRange = null
    options.resetTemplateRange()
    sync()
    void options.refreshInteractions()
    selectedNode()?.focus({ preventScroll: true })
    rememberCanvasRange()
  }

  const stopSelecting = () => {
    editingId = null
    canvasRange = null
    compositionRange = null
    pendingEdit = 0
    editRevision++
    options.resetTemplateRange()
    document.getSelection()?.removeAllRanges()
    sync()
    void options.refreshInteractions()
  }

  const format = (modifier: TemplateTextModifier, wholeIfEmpty = true): boolean => {
    const selected = options.getSelected()
    if (!options.isEditable() || selected?.type !== 'text') return false
    rememberCanvasRange()
    const sourceRange = options.getTemplateRange()
    const highlighted = canvasRange && canvasRange.end > canvasRange.start ? canvasRange : (sourceRange.end > sourceRange.start ? sourceRange : null)
    if (!highlighted && !wholeIfEmpty) return false
    const fromCanvas = canvasRange !== null || editingId !== null
    const range = highlighted ?? { start: 0, end: selected.template.length }
    const result = formatTemplateRange(selected.template, range.start, range.end, modifier)
    if (result.template.length > 8000) return true
    options.updateTemplate(result.template, result)
    if (fromCanvas) canvasRange = { start: result.start, end: result.end }
    syncModifierState()
    const revision = ++editRevision
    pendingEdit = revision
    void options.refresh().then(() => {
      if (destroyed || options.getSelected()?.id !== selected.id || revision !== editRevision) return
      pendingEdit = 0
      sync()
      if (fromCanvas && editingId && selectedNode()) {
        restoreTemplateSelection(selectedNode()!, result)
      } else if (template && highlighted) {
        template.focus({ preventScroll: true })
        template.setSelectionRange(result.start, result.end)
      }
    })
    return true
  }

  const edit = (replacement: string, range?: TemplateSourceRange) => {
    const selected = options.getSelected()
    if (!editingId || selected?.type !== 'text' || replacement.length > 8000) return
    rememberCanvasRange()
    const source = range ?? canvasRange ?? { start: selected.template.length, end: selected.template.length }
    const result = replaceTemplateRange(selected.template, source.start, source.end, replacement)
    // Match the stored template limit without letting normalization cut a token.
    if (result.template.length > 8000) return
    canvasRange = result
    options.updateTemplate(result.template, result)
    const revision = ++editRevision
    pendingEdit = revision
    void options.refresh().then(() => {
      if (destroyed || revision !== pendingEdit || selected.id !== editingId) return
      pendingEdit = 0
      sync()
      const node = selectedNode()
      if (node) { node.focus({ preventScroll: true }); restoreTemplateSelection(node, result) }
    })
  }

  listen<InputEvent>(canvas, 'beforeinput', event => {
    if (!editingId || !options.isEditable()) return
    if (compositionRange && event.isComposing) return
    if (event.inputType === 'insertCompositionText') return
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); return }
    event.preventDefault()
    rememberCanvasRange()
    const selected = options.getSelected()
    if (selected?.type !== 'text') return
    if (event.inputType.startsWith('delete')) {
      const source = canvasRange ?? { start: selected.template.length, end: selected.template.length }
      if (source.start === source.end) {
        const backward = event.inputType.endsWith('Backward')
        const adjacent = adjacentTemplateRange(selected.template, source.start, backward)
        if (adjacent) edit('', adjacent)
      } else edit('', source)
    } else if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') edit('\n')
    else if (event.inputType === 'insertText' || event.inputType === 'insertReplacementText') edit(event.data ?? '')
    else if (event.inputType === 'formatBold') format('bold')
    else if (event.inputType === 'formatItalic') format('italic')
    else if (event.inputType === 'formatUnderline') format('underline')
  })
  listen<CompositionEvent>(canvas, 'compositionstart', () => {
    if (!editingId) return
    rememberCanvasRange()
    const selected = options.getSelected()
    if (selected?.type === 'text') compositionRange = canvasRange ?? { start: selected.template.length, end: selected.template.length }
  })
  listen<CompositionEvent>(canvas, 'compositionend', event => {
    const range = compositionRange
    compositionRange = null
    if (range) edit(event.data, range)
  })
  listen<MouseEvent>(canvas, 'click', event => {
    if (!editingId || event.shiftKey) return
    const token = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-template-token-chip]') : null
    if (token && selectedNode()?.contains(token)) {
      canvasRange = { start: Number(token.dataset.templateStart), end: Number(token.dataset.templateEnd) }
      options.setTemplateRange?.(canvasRange)
      restoreTemplateSelection(selectedNode()!, canvasRange)
      syncModifierState()
    }
  })
  const copy = (event: ClipboardEvent) => {
    if (!editingId || !event.clipboardData) return
    rememberCanvasRange()
    const selected = options.getSelected()
    if (selected?.type !== 'text' || !canvasRange || canvasRange.start === canvasRange.end) return
    const text = copyTemplateRange(selected.template, canvasRange.start, canvasRange.end)
    event.preventDefault()
    event.clipboardData.setData('text/plain', text)
    event.clipboardData.setData('application/x-filaman-template-text', text)
    if (event.type === 'cut') edit('')
  }
  listen<ClipboardEvent>(canvas, 'copy', copy)
  listen<ClipboardEvent>(canvas, 'cut', copy)
  listen<ClipboardEvent>(canvas, 'paste', event => {
    if (!editingId || !event.clipboardData) return
    event.preventDefault()
    const text = event.clipboardData.getData('application/x-filaman-template-text') || event.clipboardData.getData('text/plain')
    if (text) edit(text.replace(/\r\n?/g, '\n'))
  })
  listen<DragEvent>(canvas, 'drop', event => { if (editingId) event.preventDefault() })

  listen(canvas, 'dblclick', event => {
    const node = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-label-element-type="text"], [data-label-selection-for]') : null
    const id = node?.dataset.labelElementId ?? node?.dataset.labelSelectionFor
    if (id && (node?.dataset.labelElementType === 'text' || options.getSelected()?.type === 'text')) startSelecting(id)
  })
  listen(document, 'selectionchange', rememberCanvasRange)
  listen(template, 'focus', () => { canvasRange = null; syncModifierState() })
  listen(template, 'select', () => { canvasRange = null; syncModifierState() })
  listen(toolbar, 'pointerdown', event => {
    if (!(event.target instanceof Element) || !event.target.closest('button')) return
    rememberCanvasRange()
    // Keep the highlighted range when the user presses a formatting button.
    event.preventDefault()
  })
  listen(toolbar, 'click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
    if (!button) return
    if (button.hasAttribute('data-text-select')) {
      if (editingId) stopSelecting()
      else if (options.getSelected()?.id) startSelecting(options.getSelected()!.id)
    } else if (button.dataset.textModifier) format(button.dataset.textModifier as TemplateTextModifier)
  })
  return {
    sync,
    positionToolbar,
    setGestureActive(active: boolean) {
      gestureActive = active
      positionToolbar()
    },
    format,
    insertField(token: string): boolean {
      if (!editingId || !options.isEditable()) return false
      edit(token)
      return true
    },
    handleKeydown(event: KeyboardEvent): boolean {
      if (!editingId) return false
      if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) return false
      if (event.key === 'Escape') {
        event.preventDefault()
        stopSelecting()
      } else if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        format(({ b: 'bold', i: 'italic', u: 'underline' } as const)[event.key.toLowerCase() as 'b' | 'i' | 'u'])
      }
      // Selection-mode arrows/Delete belong to text selection, not element mutations.
      return true
    },
    destroy() {
      destroyed = true
      cleanups.forEach(cleanup => cleanup())
      canvas?.querySelectorAll('[data-label-text-editing]').forEach(node => {
        node.removeAttribute('data-label-text-editing'); node.removeAttribute('contenteditable')
        node.querySelectorAll('[data-template-atomic]').forEach(token => { token.removeAttribute('contenteditable'); token.removeAttribute('draggable'); token.removeAttribute('data-template-token-chip'); token.removeAttribute('title') })
      })
      if (toolbar) toolbar.hidden = true
    },
  }
}
