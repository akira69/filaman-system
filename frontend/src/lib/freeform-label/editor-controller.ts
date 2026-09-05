import { createDefaultLabelDesign } from './defaults'
import { createLabelHistory } from './history'
import { bindLabelInteractions, type LabelInteractionController } from './interaction-adapter'
import { normalizeLabelDesign, parseLabelElementJson } from './normalize'
import type {
  LabelDesignElement,
  LabelDesignV2,
  LabelElementIdFactory,
  LabelElementType,
  LabelImageElement,
  LabelKind,
  LabelTextElement,
} from './types'

export interface LabelAssetMetadata {
  id: string
  display_name: string
  sha256: string
  media_type: string
  width: number
  height: number
  byte_size: number
  orphaned_at: string | null
  created_at: string
  updated_at: string
  content_url: string
}

export interface LabelAssetClient {
  list(): Promise<LabelAssetMetadata[]>
  upload(file: File): Promise<LabelAssetMetadata>
  delete(assetId: string): Promise<void>
}

export type LabelFieldModifier =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'inverse'
  | 'colorInverse'
  | 'caps'
  | 'date'

export interface FreeformEditorState {
  design: LabelDesignV2
  selectedId: string | null
  assets: LabelAssetMetadata[]
  assetsLoading: boolean
  assetError: string | null
  revision: number
  renderedRevision: number
  destroyed: boolean
}

export interface FreeformEditorOptions {
  initialDesign?: LabelDesignV2
  kind?: LabelKind
  createId?: LabelElementIdFactory
  assets?: LabelAssetClient
  onChange?: (state: FreeformEditorState) => void
  render?: (design: LabelDesignV2, revision: number) => void | Promise<void>
}

export interface JsonApplyResult {
  ok: boolean
  error?: string
}

const defaultId: LabelElementIdFactory = () => crypto.randomUUID()

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nextZ(design: LabelDesignV2) {
  return design.elements.length
}

function createElement(
  type: LabelElementType,
  design: LabelDesignV2,
  id: string,
): LabelDesignElement {
  const z = nextZ(design)
  const center = (w: number, h: number) => ({
    x: Math.max(0, (design.label.widthMm - w) / 2),
    y: Math.max(0, (design.label.heightMm - h) / 2),
    w: Math.min(w, design.label.widthMm),
    h: Math.min(h, design.label.heightMm),
  })
  switch (type) {
    case 'text':
      return {
        id,
        type,
        ...center(28, 8),
        z,
        template: 'Text',
        fontFamily: 'Space Grotesk',
        fontSizeMm: 3.2,
        fontWeight: 600,
        italic: false,
        underline: false,
        align: 'left',
        color: '#000000',
        wrap: true,
      }
    case 'qr':
      return {
        id,
        type,
        ...center(18, 18),
        z,
        mode: 'logo',
        linkMode: 'spool',
        urlTemplate: '',
      }
    case 'manufacturerLogo':
      return { id, type, ...center(25, 6), z, objectFit: 'contain' }
    case 'image':
      return { id, type, ...center(20, 12), z, assetId: '', objectFit: 'contain' }
    case 'swatch':
      return { id, type, ...center(30, 6), z, radiusMm: 1 }
    case 'shape':
      return {
        id,
        type,
        ...center(20, 10),
        z,
        shape: 'rectangle',
        fill: '',
        stroke: '#000000',
        strokeWidthMm: 0.3,
        radiusMm: 0,
      }
  }
}

function wrapField(token: string, modifier?: LabelFieldModifier | null) {
  switch (modifier) {
    case 'bold': return `**${token}**`
    case 'italic': return `*${token}*`
    case 'underline': return `__${token}__`
    case 'inverse': return `==${token}==`
    case 'colorInverse': return `@@${token}@@`
    case 'caps': return `^^${token}^^`
    case 'date': return token.replace(/}$/, '|date}')
    default: return token
  }
}

export function createFreeformEditorController(
  options: FreeformEditorOptions = {},
) {
  const createId = options.createId ?? defaultId
  let design = normalizeLabelDesign(
    options.initialDesign ?? createDefaultLabelDesign(options.kind ?? 'spool', createId),
    { createId },
  )
  const history = createLabelHistory(design)
  let selectedId: string | null = design.elements[0]?.id ?? null
  let assets: LabelAssetMetadata[] = []
  let assetsLoading = false
  let assetError: string | null = null
  let revision = 0
  let renderedRevision = 0
  let destroyed = false
  let templateSelection = { start: 0, end: 0 }

  const getState = (): FreeformEditorState => ({
    design: clone(design),
    selectedId,
    assets: clone(assets),
    assetsLoading,
    assetError,
    revision,
    renderedRevision,
    destroyed,
  })

  const publish = () => {
    if (!destroyed) options.onChange?.(getState())
  }

  const replaceDesign = (next: LabelDesignV2, recordHistory = true) => {
    design = normalizeLabelDesign(next, { createId })
    if (recordHistory) history.push(design)
    if (selectedId && !design.elements.some(element => element.id === selectedId)) {
      selectedId = design.elements.at(-1)?.id ?? null
    }
    publish()
    return clone(design)
  }

  const getSelectedElement = () => (
    design.elements.find(element => element.id === selectedId) ?? null
  )

  const select = (elementId: string | null) => {
    selectedId = elementId && design.elements.some(element => element.id === elementId)
      ? elementId
      : null
    templateSelection = { start: 0, end: 0 }
    publish()
    return getSelectedElement()
  }

  const addElement = (type: LabelElementType) => {
    const element = createElement(type, design, createId())
    replaceDesign({ ...design, elements: [...design.elements, element] })
    selectedId = element.id
    publish()
    return clone(getSelectedElement()!)
  }

  const updateElement = (elementId: string, changes: Partial<LabelDesignElement>) => {
    const nextElements = design.elements.map(element => (
      element.id === elementId
        ? { ...element, ...changes, id: element.id, type: element.type } as LabelDesignElement
        : element
    ))
    replaceDesign({ ...design, elements: nextElements })
    return getSelectedElement()
  }

  const updateSelected = (changes: Partial<LabelDesignElement>) => {
    if (!selectedId) return null
    return updateElement(selectedId, changes)
  }

  const deleteSelected = () => {
    if (!selectedId) return false
    const index = design.elements.findIndex(element => element.id === selectedId)
    if (index < 0) return false
    const elements = design.elements.filter(element => element.id !== selectedId)
    selectedId = elements[Math.min(index, elements.length - 1)]?.id ?? null
    replaceDesign({ ...design, elements })
    return true
  }

  const duplicateSelected = () => {
    const selected = getSelectedElement()
    if (!selected) return null
    const copy = {
      ...clone(selected),
      id: createId(),
      x: Math.min(selected.x + 2, design.label.widthMm - selected.w),
      y: Math.min(selected.y + 2, design.label.heightMm - selected.h),
      z: nextZ(design),
    } as LabelDesignElement
    replaceDesign({ ...design, elements: [...design.elements, copy] })
    selectedId = copy.id
    publish()
    return clone(getSelectedElement()!)
  }

  const moveSelected = (direction: 'forward' | 'back' | 'front' | 'backmost') => {
    if (!selectedId) return false
    const elements = [...design.elements]
    const index = elements.findIndex(element => element.id === selectedId)
    if (index < 0) return false
    const target = direction === 'front'
      ? elements.length - 1
      : direction === 'backmost'
        ? 0
        : direction === 'forward'
          ? Math.min(elements.length - 1, index + 1)
          : Math.max(0, index - 1)
    if (target === index) return false
    const [element] = elements.splice(index, 1)
    elements.splice(target, 0, element)
    replaceDesign({ ...design, elements })
    return true
  }

  const nudgeSelected = (dx: number, dy: number) => {
    const selected = getSelectedElement()
    if (!selected) return null
    return updateSelected({ x: selected.x + dx, y: selected.y + dy })
  }

  const getSelectedJson = () => {
    const selected = getSelectedElement()
    return selected ? JSON.stringify(selected, null, 2) : ''
  }

  const applySelectedJson = (source: string): JsonApplyResult => {
    const selected = getSelectedElement()
    if (!selected) return { ok: false, error: 'Select an element first' }
    try {
      const next = parseLabelElementJson(source, selected, design.label)
      updateSelected(next)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Element JSON is invalid',
      }
    }
  }

  const insertField = (token: string, modifier?: LabelFieldModifier | null) => {
    const inserted = wrapField(token, modifier)
    let selected = getSelectedElement()
    if (selected?.type !== 'text') {
      selected = addElement('text')
      updateSelected({ template: inserted })
      return clone(getSelectedElement() as LabelTextElement)
    }
    const start = Math.min(templateSelection.start, selected.template.length)
    const end = Math.min(Math.max(templateSelection.end, start), selected.template.length)
    const template = `${selected.template.slice(0, start)}${inserted}${selected.template.slice(end)}`
    updateSelected({ template })
    templateSelection = { start: start + inserted.length, end: start + inserted.length }
    return clone(getSelectedElement() as LabelTextElement)
  }

  const loadAssets = async () => {
    if (!options.assets) return []
    assetsLoading = true
    assetError = null
    publish()
    try {
      assets = await options.assets.list()
      return clone(assets)
    } catch (error) {
      assetError = error instanceof Error ? error.message : 'Could not load label images'
      throw error
    } finally {
      assetsLoading = false
      publish()
    }
  }

  const uploadAsset = async (file: File) => {
    if (!options.assets) throw new Error('Label image uploads are unavailable')
    const asset = await options.assets.upload(file)
    assets = [asset, ...assets.filter(candidate => candidate.id !== asset.id)]
    assetError = null
    publish()
    return clone(asset)
  }

  const deleteAsset = async (assetId: string) => {
    if (!options.assets) throw new Error('Label image deletion is unavailable')
    await options.assets.delete(assetId)
    assets = assets.filter(asset => asset.id !== assetId)
    publish()
  }

  const requestRender = async () => {
    const currentRevision = ++revision
    const render = options.render
    publish()
    if (!render || destroyed) return
    await render(clone(design), currentRevision)
    if (!destroyed && currentRevision === revision) {
      renderedRevision = currentRevision
      publish()
    }
  }

  return {
    getState,
    getSelectedElement: () => clone(getSelectedElement()),
    getSelectedJson,
    select,
    clearSelection: () => select(null),
    addElement,
    addImage(assetId: string): LabelImageElement {
      addElement('image')
      updateSelected({ assetId })
      return clone(getSelectedElement() as LabelImageElement)
    },
    updateElement,
    updateSelected,
    deleteSelected,
    duplicateSelected,
    moveSelected,
    nudgeSelected,
    applySelectedJson,
    setTemplateSelection(start: number, end = start) {
      templateSelection = { start: Math.max(0, start), end: Math.max(0, end) }
    },
    insertField,
    loadAssets,
    uploadAsset,
    deleteAsset,
    requestRender,
    beginGesture() {
      history.beginGesture()
    },
    updateGesture(elementId: string, changes: Partial<LabelDesignElement>) {
      const nextElements = design.elements.map(element => (
        element.id === elementId
          ? { ...element, ...changes, id: element.id, type: element.type } as LabelDesignElement
          : element
      ))
      design = normalizeLabelDesign({ ...design, elements: nextElements }, { createId })
      history.updateGesture(design)
      publish()
    },
    endGesture() {
      design = history.endGesture()
      publish()
    },
    undo() {
      design = history.undo()
      publish()
      return clone(design)
    },
    redo() {
      design = history.redo()
      publish()
      return clone(design)
    },
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    reset(next: LabelDesignV2) {
      design = normalizeLabelDesign(next, { createId })
      history.reset(design)
      selectedId = design.elements[0]?.id ?? null
      publish()
    },
    destroy() {
      destroyed = true
    },
  }
}

export type FreeformEditorController = ReturnType<typeof createFreeformEditorController>

export interface BindFreeformEditorDomOptions {
  root?: ParentNode
  controller: FreeformEditorController
  editable?: boolean
}

function isElementProperty(value: string): value is keyof LabelDesignElement {
  return [
    'x', 'y', 'w', 'h', 'template', 'fontFamily', 'fontSizeMm',
    'fontWeight', 'align', 'assetId',
  ].includes(value)
}

export function bindFreeformEditorDom(options: BindFreeformEditorDomOptions) {
  const root = options.root ?? document
  const controller = options.controller
  const cleanups: Array<() => void> = []
  let interaction: LabelInteractionController | null = null
  let activeModifier: LabelFieldModifier | null = null

  const listen = <T extends Event>(
    target: EventTarget | null | undefined,
    event: string,
    listener: (event: T) => void,
  ) => {
    if (!target) return
    const handler = listener as EventListener
    target.addEventListener(event, handler)
    cleanups.push(() => target.removeEventListener(event, handler))
  }

  const query = <T extends Element>(selector: string) => root.querySelector<T>(selector)
  const queryAll = <T extends Element>(selector: string) => Array.from(root.querySelectorAll<T>(selector))
  const canvasHost = query<HTMLElement>('#freeform-canvas-host')
  const canvas = canvasHost?.querySelector<HTMLElement>('.label-preview') ?? null

  const syncDom = () => {
    const state = controller.getState()
    const selected = controller.getSelectedElement()
    const title = query<HTMLElement>('#freeform-inspector-title')
    const empty = query<HTMLElement>('#freeform-inspector-empty')
    const fields = query<HTMLElement>('#freeform-inspector-fields')
    if (title) title.textContent = selected ? selected.type : 'No selection'
    if (empty) empty.hidden = Boolean(selected)
    if (fields) fields.hidden = !selected

    queryAll<HTMLElement>('[data-element-section]').forEach(section => {
      section.hidden = section.dataset.elementSection !== selected?.type
    })
    queryAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-element-prop]').forEach(input => {
      const property = input.dataset.elementProp
      if (!selected || !property || !isElementProperty(property) || !(property in selected)) return
      const value = selected[property]
      if (typeof value === 'string' || typeof value === 'number') input.value = String(value)
    })
    const json = query<HTMLTextAreaElement>('#freeform-element-json')
    if (json && document.activeElement !== json) json.value = controller.getSelectedJson()
    const template = query<HTMLTextAreaElement>('#freeform-template')
    if (template && selected?.type === 'text' && document.activeElement !== template) {
      template.value = selected.template
    }
    const imageSelect = query<HTMLSelectElement>('#freeform-image-asset')
    if (imageSelect) {
      const current = selected?.type === 'image' ? selected.assetId : ''
      imageSelect.replaceChildren(
        ...state.assets.map(asset => {
          const option = document.createElement('option')
          option.value = asset.id
          option.textContent = asset.display_name
          option.selected = asset.id === current
          return option
        }),
      )
    }
    queryAll<HTMLButtonElement>('[data-designer-action="undo"]').forEach(button => { button.disabled = !controller.canUndo() })
    queryAll<HTMLButtonElement>('[data-designer-action="redo"]').forEach(button => { button.disabled = !controller.canRedo() })
    queryAll<HTMLElement>('[data-label-element-id]').forEach(element => {
      element.classList.toggle('is-selected', element.dataset.labelElementId === state.selectedId)
    })
  }

  const refresh = async () => {
    await controller.requestRender()
    syncDom()
    interaction?.refresh()
  }

  const mutate = (operation: () => unknown) => {
    operation()
    syncDom()
    void refresh()
  }

  queryAll<HTMLButtonElement>('[data-designer-add]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const type = button.dataset.designerAdd as LabelElementType | undefined
      if (type) mutate(() => controller.addElement(type))
    })
  })

  queryAll<HTMLButtonElement>('[data-designer-action]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      switch (button.dataset.designerAction) {
        case 'undo': mutate(() => controller.undo()); break
        case 'redo': mutate(() => controller.redo()); break
        case 'duplicate': mutate(() => controller.duplicateSelected()); break
        case 'delete': mutate(() => controller.deleteSelected()); break
        case 'forward': mutate(() => controller.moveSelected('forward')); break
        case 'back': mutate(() => controller.moveSelected('back')); break
      }
    })
  })

  queryAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-element-prop]').forEach(input => {
    listen<Event>(input, 'change', () => {
      const property = input.dataset.elementProp
      if (!property || !isElementProperty(property)) return
      const numeric = ['x', 'y', 'w', 'h', 'fontSizeMm', 'fontWeight'].includes(property)
      mutate(() => controller.updateSelected({
        [property]: numeric ? Number(input.value) : input.value,
      } as Partial<LabelDesignElement>))
    })
  })

  const template = query<HTMLTextAreaElement>('#freeform-template')
  const rememberTemplateSelection = () => {
    if (!template) return
    controller.setTemplateSelection(
      template.selectionStart ?? template.value.length,
      template.selectionEnd ?? template.value.length,
    )
  }
  listen(template, 'select', rememberTemplateSelection)
  listen(template, 'keyup', rememberTemplateSelection)
  listen(template, 'click', rememberTemplateSelection)

  queryAll<HTMLButtonElement>('[data-field-modifier]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const modifier = button.dataset.fieldModifier as LabelFieldModifier
      activeModifier = activeModifier === modifier ? null : modifier
      queryAll<HTMLButtonElement>('[data-field-modifier]').forEach(candidate => {
        candidate.setAttribute('aria-pressed', String(candidate.dataset.fieldModifier === activeModifier))
      })
    })
  })
  queryAll<HTMLButtonElement>('[data-field-token]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const token = button.dataset.fieldToken
      if (!token) return
      mutate(() => controller.insertField(token, activeModifier))
      activeModifier = null
      queryAll<HTMLButtonElement>('[data-field-modifier]').forEach(candidate => candidate.setAttribute('aria-pressed', 'false'))
    })
  })

  queryAll<HTMLButtonElement>('[data-field-group-tab]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const group = button.dataset.fieldGroupTab
      queryAll<HTMLButtonElement>('[data-field-group-tab]').forEach(candidate => {
        candidate.setAttribute('aria-selected', String(candidate === button))
      })
      queryAll<HTMLElement>('[data-field-group]').forEach(panel => {
        panel.hidden = panel.dataset.fieldGroup !== group
      })
    })
  })

  const json = query<HTMLTextAreaElement>('#freeform-element-json')
  const jsonError = query<HTMLElement>('#freeform-json-error')
  listen<MouseEvent>(query('#freeform-json-apply'), 'click', () => {
    const result = controller.applySelectedJson(json?.value ?? '')
    if (jsonError) jsonError.textContent = result.error ?? ''
    if (result.ok) {
      syncDom()
      void refresh()
    }
  })
  listen<MouseEvent>(query('#freeform-json-revert'), 'click', () => {
    if (json) json.value = controller.getSelectedJson()
    if (jsonError) jsonError.textContent = ''
  })
  listen<MouseEvent>(query('#freeform-json-expand'), 'click', () => {
    query<HTMLElement>('.freeform-json-section')?.classList.toggle('is-expanded')
  })

  const upload = query<HTMLInputElement>('#freeform-image-upload')
  listen<Event>(upload, 'change', () => {
    const file = upload?.files?.[0]
    if (!file) return
    void controller.uploadAsset(file).then(asset => {
      controller.addImage(asset.id)
      syncDom()
      void refresh()
    }).catch(error => {
      const status = query<HTMLElement>('#freeform-image-status')
      if (status) status.textContent = error instanceof Error ? error.message : 'Upload failed'
    })
  })
  listen<MouseEvent>(query('#freeform-image-delete'), 'click', () => {
    const selected = controller.getSelectedElement()
    if (selected?.type !== 'image' || !selected.assetId) return
    void controller.deleteAsset(selected.assetId).then(syncDom).catch(error => {
      const status = query<HTMLElement>('#freeform-image-status')
      if (status) status.textContent = error instanceof Error ? error.message : 'Delete failed'
    })
  })

  listen<KeyboardEvent>(canvasHost, 'keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
    const step = event.shiftKey ? 1 : 0.1
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      mutate(() => event.shiftKey ? controller.redo() : controller.undo())
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      mutate(() => controller.duplicateSelected())
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      mutate(() => controller.deleteSelected())
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      mutate(() => controller.nudgeSelected(dx, dy))
    }
  })

  syncDom()
  void refresh().then(async () => {
    if (!canvas || options.editable === false) return
    interaction = await bindLabelInteractions({
      root: canvas,
      getDesign: () => controller.getState().design,
      editable: true,
      onSelect: elementId => {
        controller.select(elementId)
        syncDom()
      },
      onGeometryChange: (elementId, geometry) => controller.updateGesture(elementId, geometry),
      onGestureStart: () => controller.beginGesture(),
      onGestureEnd: () => {
        controller.endGesture()
        syncDom()
      },
    })
    syncDom()
  })
  void controller.loadAssets().then(syncDom).catch(() => syncDom())

  return {
    refresh,
    sync: syncDom,
    destroy() {
      interaction?.destroy()
      cleanups.splice(0).forEach(cleanup => cleanup())
      controller.destroy()
    },
  }
}
