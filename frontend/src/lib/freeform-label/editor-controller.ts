import { createDefaultLabelDesign } from './defaults'
import { createLabelAssetClient } from './assets'
import { createLabelHistory } from './history'
import {
  bindLabelInteractions,
  type InteractFactory,
  type LabelInteractionController,
} from './interaction-adapter'
import { normalizeLabelDesign, parseLabelElementJson } from './normalize'
import { deleteLabelPreset, saveLabelPreset } from '../label-preset-storage'
import type { DesignerExtraField } from '../label-designer'
import type {
  LabelDesignElement,
  LabelDesignV2,
  LabelDesignerPresetData,
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
  translate?: (key: string, fallback: string) => string
}

export interface FreeformLabelDesignerEditorOptions {
  extraFields?: DesignerExtraField[]
  entityType?: LabelKind
  batchMode?: boolean
  getFilamentColorHex?: () => string | null | undefined
  getFilamentColorHexes?: () => string | null | undefined
  getFilamentMultiColorStyle?: () => string | null | undefined
  onChange: () => void | Promise<void>
  safeSetLocalStorage?: (key: string, value: string) => boolean
  translate?: (key: string, fallback: string) => string
  presetsKey: string
  settingsKey: string
  entityLabel?: string
  crossPresetsKey?: string
  ownPresetsLabel?: string
  crossPresetsLabel?: string
  loadInteract?: () => Promise<InteractFactory>
}

export interface FreeformLabelDesignerEditorController {
  getDesign: () => LabelDesignV2
  loadSettings: () => void
  refresh: () => Promise<void>
  refreshInteractions: () => Promise<void>
  refreshExtraFields: (extraFields: DesignerExtraField[]) => void
  refreshPresetList: (selectName?: string) => void
  refreshTokenAreas: () => void
  destroy: () => void
}

export interface JsonApplyResult {
  ok: boolean
  error?: string
}

const defaultId: LabelElementIdFactory = () => crypto.randomUUID()
const activeEditors = new Map<string, FreeformEditorController>()
export const FREEFORM_EDITOR_BREAKPOINT_PX = 900

const elementLabelKeys: Record<LabelElementType, string> = {
  text: 'labelDesigner.elementText',
  qr: 'labelDesigner.elementQr',
  manufacturerLogo: 'labelDesigner.elementManufacturerLogo',
  image: 'labelDesigner.elementImage',
  swatch: 'labelDesigner.elementSwatch',
  shape: 'labelDesigner.elementShape',
}

const elementLabelFallbacks: Record<LabelElementType, string> = {
  text: 'Text element',
  qr: 'QR code element',
  manufacturerLogo: 'Manufacturer logo element',
  image: 'Image element',
  swatch: 'Color swatch element',
  shape: 'Shape element',
}

const jsonErrorKeys = new Map<string, string>([
  ['Element JSON must be valid JSON', 'labelDesigner.jsonInvalid'],
  ['Element JSON must contain an object', 'labelDesigner.jsonMustBeObject'],
  ['Element id cannot be changed', 'labelDesigner.jsonIdImmutable'],
  ['Element type cannot be changed', 'labelDesigner.jsonTypeImmutable'],
  ['Element type is not supported', 'labelDesigner.jsonUnsupportedType'],
])

function clone<T>(value: T): T {
  return structuredClone(value)
}

function localizedErrorMessage(
  error: unknown,
  translate: (key: string, fallback: string) => string,
  key: string,
  fallback: string,
) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : translate(key, fallback)
}

function readJsonObject(key: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function persistFreeformLabelDesign(settingsKey: string, design: LabelDesignV2) {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({ version: 2, design }))
    return true
  } catch {
    return false
  }
}

function loadStoredFreeformLabelDesign(options: {
  settingsKey: string
  presetsKey: string
  kind: LabelKind
}): LabelDesignV2 {
  const working = readJsonObject(options.settingsKey)
  if (working?.version === 2 && working.design) {
    return normalizeLabelDesign(working.design)
  }

  const cache = readJsonObject(options.presetsKey)
  const presets = Array.isArray(cache?.presets) ? cache.presets : []
  for (const candidate of presets) {
    if (!candidate || typeof candidate !== 'object') continue
    const data = (candidate as { data?: unknown }).data
    if (!data || typeof data !== 'object') continue
    const preset = data as { version?: unknown; design?: unknown }
    if (preset.version === 2 && preset.design) return normalizeLabelDesign(preset.design)
  }
  return createDefaultLabelDesign(options.kind)
}

export function loadFreeformLabelDesign(options: {
  settingsKey: string
  presetsKey: string
  kind: LabelKind
}): LabelDesignV2 {
  const active = activeEditors.get(options.settingsKey)
  return active?.getState().design ?? loadStoredFreeformLabelDesign(options)
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
  const translate = options.translate ?? ((_key: string, fallback: string) => fallback)
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
    if (!selected) return { ok: false, error: translate('labelDesigner.selectElementFirst', 'Select an element first') }
    try {
      const next = parseLabelElementJson(source, selected, design.label)
      updateSelected(next)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error
          ? translate(jsonErrorKeys.get(error.message) ?? 'labelDesigner.jsonInvalid', error.message)
          : translate('labelDesigner.jsonInvalid', 'Element JSON is invalid'),
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
      assetError = localizedErrorMessage(
        error,
        translate,
        'labelDesigner.imageLoadFailed',
        'Could not load label images',
      )
      throw error
    } finally {
      assetsLoading = false
      publish()
    }
  }

  const uploadAsset = async (file: File) => {
    if (!options.assets) throw new Error(translate('labelDesigner.imageUploadUnavailable', 'Label image uploads are unavailable'))
    const asset = await options.assets.upload(file)
    assets = [asset, ...assets.filter(candidate => candidate.id !== asset.id)]
    assetError = null
    publish()
    return clone(asset)
  }

  const deleteAsset = async (assetId: string) => {
    if (!options.assets) throw new Error(translate('labelDesigner.imageDeleteUnavailable', 'Label image deletion is unavailable'))
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
    updateLabel(changes: Partial<LabelDesignV2['label']>) {
      return replaceDesign({
        ...design,
        label: { ...design.label, ...changes },
      })
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
  loadInteract?: () => Promise<InteractFactory>
  translate?: (key: string, fallback: string) => string
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
  let editable = options.editable !== false
  let activeModifier: LabelFieldModifier | null = null
  const translate = options.translate ?? ((_key: string, fallback: string) => fallback)

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
  const workspace = query<HTMLElement>('#freeform-designer-workspace')
  let interactionRoot: HTMLElement | null = null
  let interactionGeneration = 0

  const syncDom = () => {
    const state = controller.getState()
    const selected = controller.getSelectedElement()
    const title = query<HTMLElement>('#freeform-inspector-title')
    const empty = query<HTMLElement>('#freeform-inspector-empty')
    const fields = query<HTMLElement>('#freeform-inspector-fields')
    if (title) {
      title.textContent = selected
        ? translate(elementLabelKeys[selected.type], elementLabelFallbacks[selected.type])
        : translate('labelDesigner.noSelection', 'No element selected')
    }
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
    queryAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>([
      '[data-designer-add]',
      '[data-designer-action]',
      '[data-element-prop]',
      '[data-field-modifier]',
      '[data-field-token]',
      '#freeform-json-apply',
      '#freeform-image-upload',
      '#freeform-image-delete',
    ].join(',')).forEach(control => { control.disabled = !editable })
    queryAll<HTMLButtonElement>('[data-designer-action="undo"]').forEach(button => { button.disabled = !editable || !controller.canUndo() })
    queryAll<HTMLButtonElement>('[data-designer-action="redo"]').forEach(button => { button.disabled = !editable || !controller.canRedo() })
    canvasHost?.setAttribute('aria-readonly', String(!editable))
    if (workspace) workspace.dataset.editorEditable = String(editable)
    for (const chrome of queryAll<HTMLElement>('.freeform-toolbar, #freeform-element-inspector, #freeform-field-dock')) {
      chrome.toggleAttribute('inert', !editable)
      chrome.toggleAttribute('aria-hidden', !editable)
    }
    queryAll<HTMLElement>('[data-label-element-id]').forEach(element => {
      element.classList.toggle('is-selected', editable && element.dataset.labelElementId === state.selectedId)
      const type = element.dataset.labelElementType as LabelElementType | undefined
      if (editable && type && type in elementLabelKeys) {
        element.tabIndex = 0
        element.setAttribute('role', 'button')
        element.setAttribute('aria-label', translate(elementLabelKeys[type], elementLabelFallbacks[type]))
      } else {
        element.removeAttribute('tabindex')
        element.removeAttribute('role')
        element.removeAttribute('aria-label')
      }
    })
  }

  const refreshInteraction = async () => {
    const canvas = canvasHost?.querySelector<HTMLElement>('.label-preview') ?? null
    if (!canvas || !editable) {
      interactionGeneration += 1
      interaction?.destroy()
      interaction = null
      interactionRoot = null
      return
    }
    if (interaction && interactionRoot === canvas) {
      interaction.refresh()
      return
    }
    interaction?.destroy()
    interaction = null
    interactionRoot = null
    const generation = ++interactionGeneration
    const next = await bindLabelInteractions({
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
      loadInteract: options.loadInteract,
    })
    if (generation !== interactionGeneration || canvas !== canvasHost?.querySelector('.label-preview')) {
      next.destroy()
      return
    }
    interaction = next
    interactionRoot = canvas
  }

  const refresh = async () => {
    await controller.requestRender()
    syncDom()
    await refreshInteraction()
    syncDom()
  }

  const focusElement = (elementId: string | null) => {
    const target = elementId
      ? canvasHost?.querySelector<HTMLElement>(`[data-label-element-id="${CSS.escape(elementId)}"]`)
      : null
    ;(target ?? canvasHost)?.focus()
  }

  const mutate = (operation: () => unknown, focusAfter?: 'selected' | 'canvas') => {
    if (!editable) return
    operation()
    syncDom()
    void refresh().then(() => {
      if (focusAfter === 'selected') focusElement(controller.getState().selectedId)
      if (focusAfter === 'canvas') focusElement(null)
    })
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
        case 'duplicate': mutate(() => controller.duplicateSelected(), 'selected'); break
        case 'delete': mutate(() => controller.deleteSelected(), 'canvas'); break
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
  listen<MouseEvent>(root as ParentNode & EventTarget, 'click', event => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-field-token]')
      : null
    if (!target || !root.contains(target)) return
    const token = target.dataset.fieldToken
    if (!token) return
    mutate(() => controller.insertField(token, activeModifier))
    activeModifier = null
    queryAll<HTMLButtonElement>('[data-field-modifier]').forEach(candidate => candidate.setAttribute('aria-pressed', 'false'))
  })

  const fieldTabs = queryAll<HTMLButtonElement>('[data-field-group-tab]')
  const activateFieldTab = (button: HTMLButtonElement) => {
    const group = button.dataset.fieldGroupTab
    fieldTabs.forEach(candidate => {
      const active = candidate === button
      candidate.setAttribute('aria-selected', String(active))
      candidate.tabIndex = active ? 0 : -1
    })
    queryAll<HTMLElement>('[data-field-group]').forEach(panel => {
      panel.hidden = panel.dataset.fieldGroup !== group
    })
  }
  fieldTabs.forEach(button => {
    listen<MouseEvent>(button, 'click', () => activateFieldTab(button))
    listen<KeyboardEvent>(button, 'keydown', event => {
      const current = fieldTabs.indexOf(button)
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? fieldTabs.length - 1
          : event.key === 'ArrowRight'
            ? (current + 1) % fieldTabs.length
            : event.key === 'ArrowLeft'
              ? (current - 1 + fieldTabs.length) % fieldTabs.length
              : -1
      if (next < 0) return
      event.preventDefault()
      activateFieldTab(fieldTabs[next])
      fieldTabs[next].focus()
    })
  })

  const json = query<HTMLTextAreaElement>('#freeform-element-json')
  const jsonError = query<HTMLElement>('#freeform-json-error')
  listen<MouseEvent>(query('#freeform-json-apply'), 'click', () => {
    if (!editable) return
    const result = controller.applySelectedJson(json?.value ?? '')
    if (jsonError) jsonError.textContent = result.error ?? ''
    if (result.ok) json?.removeAttribute('aria-invalid')
    else json?.setAttribute('aria-invalid', 'true')
    if (result.ok) {
      syncDom()
      void refresh()
    }
  })
  listen<MouseEvent>(query('#freeform-json-revert'), 'click', () => {
    if (json) json.value = controller.getSelectedJson()
    if (jsonError) jsonError.textContent = ''
    json?.removeAttribute('aria-invalid')
  })
  listen<MouseEvent>(query('#freeform-json-expand'), 'click', () => {
    const button = query<HTMLButtonElement>('#freeform-json-expand')
    const expanded = query<HTMLElement>('.freeform-json-section')?.classList.toggle('is-expanded') ?? false
    button?.setAttribute('aria-expanded', String(expanded))
    if (button) button.textContent = expanded
      ? translate('labelDesigner.collapse', 'Collapse')
      : translate('labelDesigner.expand', 'Expand')
  })

  const upload = query<HTMLInputElement>('#freeform-image-upload')
  listen<Event>(upload, 'change', () => {
    if (!editable) return
    const file = upload?.files?.[0]
    if (!file) return
    void controller.uploadAsset(file).then(asset => {
      controller.addImage(asset.id)
      syncDom()
      void refresh()
    }).catch(error => {
      const status = query<HTMLElement>('#freeform-image-status')
      if (status) status.textContent = localizedErrorMessage(
        error,
        translate,
        'labelDesigner.imageUploadFailed',
        'Upload failed',
      )
    })
  })
  listen<MouseEvent>(query('#freeform-image-delete'), 'click', () => {
    if (!editable) return
    const selected = controller.getSelectedElement()
    if (selected?.type !== 'image' || !selected.assetId) return
    void controller.deleteAsset(selected.assetId).then(syncDom).catch(error => {
      const status = query<HTMLElement>('#freeform-image-status')
      if (status) status.textContent = localizedErrorMessage(
        error,
        translate,
        'labelDesigner.imageDeleteFailed',
        'Delete failed',
      )
    })
  })

  listen<KeyboardEvent>(canvasHost, 'keydown', event => {
    if (!editable) return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-label-element-id]')
      : null
    if ((event.key === 'Enter' || event.key === ' ') && element?.dataset.labelElementId) {
      event.preventDefault()
      controller.select(element.dataset.labelElementId)
      syncDom()
      return
    }
    const step = event.shiftKey ? 1 : 0.1
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      mutate(() => event.shiftKey ? controller.redo() : controller.undo())
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      mutate(() => controller.duplicateSelected(), 'selected')
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      mutate(() => controller.deleteSelected(), 'canvas')
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      mutate(() => controller.nudgeSelected(dx, dy), 'selected')
    }
  })
  listen<FocusEvent>(canvasHost, 'focusin', event => {
    if (!editable) return
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-label-element-id]')
      : null
    if (!element?.dataset.labelElementId) return
    controller.select(element.dataset.labelElementId)
    syncDom()
  })

  syncDom()
  void refresh()
  void controller.loadAssets().then(syncDom).catch(() => syncDom())

  return {
    refresh,
    refreshInteractions: refreshInteraction,
    sync: syncDom,
    async setEditable(next: boolean) {
      editable = next
      syncDom()
      await refreshInteraction()
      syncDom()
    },
    destroy() {
      interactionGeneration += 1
      interaction?.destroy()
      cleanups.splice(0).forEach(cleanup => cleanup())
      controller.destroy()
    },
  }
}

interface StoredPreset {
  name: string
  data: LabelDesignerPresetData
  settings?: unknown
}

function readStoredPresets(storageKey: string): StoredPreset[] {
  const value = readJsonObject(storageKey)
  const presets = Array.isArray(value?.presets) ? value.presets : []
  return presets.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return []
    const { name, data, settings } = candidate as { name?: unknown; data?: unknown; settings?: unknown }
    if (typeof name !== 'string' || !data || typeof data !== 'object') return []
    const payload = data as { version?: unknown; design?: unknown; legacy_v1?: unknown }
    if (payload.version !== 2 || !payload.design) return []
    const normalizedData: LabelDesignerPresetData = {
      version: 2,
      design: normalizeLabelDesign(payload.design),
    }
    if ('legacy_v1' in payload) normalizedData.legacy_v1 = clone(payload.legacy_v1)
    return [{
      name,
      data: normalizedData,
      settings: settings === undefined ? normalizedData.legacy_v1 : clone(settings),
    }]
  })
}

export function getFreeformLabelPresetNames(storageKey: string) {
  return readStoredPresets(storageKey).map(preset => preset.name)
}

export function loadFreeformLabelPresetDesign(options: {
  presetsKey: string
  presetName: string
  kind: LabelKind
}): LabelDesignV2 | null {
  const preset = readStoredPresets(options.presetsKey)
    .find(candidate => candidate.name === options.presetName)
  return preset ? normalizeLabelDesign(preset.data.design) : null
}

function writeStoredPresets(storageKey: string, presets: StoredPreset[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      presets: presets.map(preset => ({
        ...preset,
        settings: preset.settings ?? preset.data.legacy_v1 ?? {},
      })),
    }))
    return true
  } catch {
    return false
  }
}

async function persistStoredPresetMutation(
  storageKey: string,
  presets: StoredPreset[],
  mutateDatabase: () => Promise<boolean>,
) {
  let previous: string | null
  try {
    previous = localStorage.getItem(storageKey)
  } catch {
    return false
  }
  if (!writeStoredPresets(storageKey, presets)) return false
  try {
    if (await mutateDatabase()) return true
  } catch {
    // Treat an unexpected request rejection like a reported database failure.
  }
  try {
    if (previous === null) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, previous)
  } catch {
    // The failed database mutation is still reported to the user.
  }
  return false
}

export async function initFreeformLabelDesignerEditor(
  options: FreeformLabelDesignerEditorOptions,
): Promise<FreeformLabelDesignerEditorController> {
  const entityType = options.entityType ?? 'spool'
  const initialDesign = loadFreeformLabelDesign({
    settingsKey: options.settingsKey,
    presetsKey: options.presetsKey,
    kind: entityType,
  })
  let lastPersisted = JSON.stringify(initialDesign)
  let extraFields = options.extraFields ?? []
  let domBinding: ReturnType<typeof bindFreeformEditorDom> | null = null
  const controller = createFreeformEditorController({
    initialDesign,
    kind: entityType,
    assets: createLabelAssetClient(),
    translate: options.translate,
    onChange: state => {
      const serialized = JSON.stringify(state.design)
      if (serialized !== lastPersisted) {
        lastPersisted = serialized
        persistFreeformLabelDesign(options.settingsKey, state.design)
      }
      const summary = document.getElementById('freeform-selection-summary')
      if (summary) {
        const selected = state.design.elements.find(element => element.id === state.selectedId)
        const typeName = selected
          ? (options.translate?.(elementLabelKeys[selected.type], elementLabelFallbacks[selected.type]) ?? elementLabelFallbacks[selected.type])
          : ''
        summary.textContent = selected
          ? (options.translate?.('labelDesigner.selectionSummary', '{type} · {width} × {height} mm') ?? '{type} · {width} × {height} mm')
            .replace('{type}', typeName)
            .replace('{width}', selected.w.toFixed(1))
            .replace('{height}', selected.h.toFixed(1))
          : (options.translate?.('labelDesigner.noSelection', 'No element selected') ?? 'No element selected')
      }
    },
    render: async () => {
      await options.onChange()
    },
  })
  activeEditors.set(options.settingsKey, controller)

  const width = document.getElementById('freeform-label-width') as HTMLInputElement | null
  const height = document.getElementById('freeform-label-height') as HTMLInputElement | null
  const margin = document.getElementById('freeform-label-margin') as HTMLInputElement | null
  const border = document.getElementById('freeform-label-border') as HTMLInputElement | null
  const presetSelect = document.getElementById('freeform-preset-list') as HTMLSelectElement | null
  const presetName = document.getElementById('freeform-preset-name') as HTMLInputElement | null
  const presetLoad = document.getElementById('freeform-preset-load') as HTMLButtonElement | null
  const presetSave = document.getElementById('freeform-preset-save') as HTMLButtonElement | null
  const presetDelete = document.getElementById('freeform-preset-delete') as HTMLButtonElement | null
  const presetStatus = document.getElementById('freeform-preset-status')
  const mobileNotice = document.getElementById('freeform-mobile-notice')
  const workspace = document.getElementById('freeform-designer-workspace')
  const editorContainer = workspace?.parentElement ?? workspace
  const cleanups: Array<() => void> = []
  const measuredWorkspaceWidth = () => {
    const workspaceWidth = workspace?.getBoundingClientRect().width ?? 0
    const measured = workspaceWidth > 0
      ? workspaceWidth
      : (editorContainer?.getBoundingClientRect().width ?? 0)
    return measured > 0 ? measured : window.innerWidth
  }
  let editorEditable = measuredWorkspaceWidth() > FREEFORM_EDITOR_BREAKPOINT_PX
  let resizeObserver: ResizeObserver | null = null
  let destroyed = false
  let pendingPresetMutations = 0
  let presetMutationTail: Promise<void> = Promise.resolve()

  const listen = <T extends Event>(target: EventTarget | null, event: string, listener: (event: T) => void) => {
    if (!target) return
    const handler = listener as EventListener
    target.addEventListener(event, handler)
    cleanups.push(() => target.removeEventListener(event, handler))
  }
  const setStatus = (message: string) => {
    if (presetStatus) presetStatus.textContent = message
  }
  const syncSidebarMutationControls = () => {
    for (const control of [width, height, margin, border, presetName, presetLoad]) {
      if (control) control.disabled = !editorEditable
    }
    if (presetSave) presetSave.disabled = !editorEditable || pendingPresetMutations > 0
    if (presetDelete) presetDelete.disabled = !editorEditable || pendingPresetMutations > 0
  }
  const enqueuePresetMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    pendingPresetMutations += 1
    syncSidebarMutationControls()
    const queued = presetMutationTail.then(operation)
    presetMutationTail = queued.then(() => undefined, () => undefined)
    try {
      return await queued
    } finally {
      pendingPresetMutations -= 1
      syncSidebarMutationControls()
    }
  }
  const syncGeometry = () => {
    const label = controller.getState().design.label
    if (width) width.value = String(label.widthMm)
    if (height) height.value = String(label.heightMm)
    if (margin) margin.value = String(label.marginMm)
    if (border) border.checked = label.border
  }
  const renderExtraFields = () => {
    const container = document.getElementById('freeform-extra-fields')
    if (!container) return
    if (extraFields.length === 0) {
      const empty = document.createElement('span')
      empty.dataset.i18n = 'labelDesigner.noExtraFields'
      empty.textContent = options.translate?.('labelDesigner.noExtraFields', 'No custom fields available.') ?? 'No custom fields available.'
      container.replaceChildren(empty)
      return
    }
    container.replaceChildren(...extraFields.map(field => {
      const button = document.createElement('button')
      const source = field.source === 'filament' || field.source === 'spool' ? field.source : entityType
      const key = field.key.startsWith(`${source}.`) ? field.key : `${source}.${field.key}`
      button.type = 'button'
      button.className = 'freeform-token-chip'
      button.dataset.fieldToken = `{${key}}`
      button.title = button.dataset.fieldToken
      button.textContent = field.label || field.key
      return button
    }))
  }
  const refreshPresetList = (selectName?: string) => {
    if (!presetSelect) return
    const own = readStoredPresets(options.presetsKey)
    const cross = options.crossPresetsKey ? readStoredPresets(options.crossPresetsKey) : []
    const groups: HTMLOptGroupElement[] = []
    const appendGroup = (label: string, prefix: string, presets: StoredPreset[]) => {
      if (presets.length === 0) return
      const group = document.createElement('optgroup')
      group.label = label
      for (const preset of presets) {
        const item = document.createElement('option')
        item.value = `${prefix}:${preset.name}`
        item.textContent = preset.name
        group.append(item)
      }
      groups.push(group)
    }
    const ownFallback = `${options.entityLabel ?? 'Label'} presets`
    const ownLabel = options.ownPresetsLabel
      ?? (options.translate?.('labelDesigner.ownPresets', '{entity} presets') ?? '{entity} presets')
        .replace('{entity}', options.entityLabel ?? 'Label')
    appendGroup(ownLabel || ownFallback, 'own', own)
    appendGroup(
      options.crossPresetsLabel
        ?? (options.translate?.('labelDesigner.otherPresets', 'Other presets') ?? 'Other presets'),
      'cross',
      cross,
    )
    presetSelect.replaceChildren(...groups)
    const preferred = selectName ? `own:${selectName}` : presetSelect.options[0]?.value
    if (preferred) presetSelect.value = preferred
    const names = own.map(preset => preset.name)
    document.dispatchEvent(new CustomEvent('freeform-label-presets-changed', {
      detail: { presets: names },
    }))
  }
  const selectedPreset = () => {
    const [source, ...nameParts] = (presetSelect?.value ?? '').split(':')
    const name = nameParts.join(':')
    const storageKey = source === 'cross' ? options.crossPresetsKey : options.presetsKey
    return storageKey
      ? readStoredPresets(storageKey).find(preset => preset.name === name) ?? null
      : null
  }
  const loadSettings = () => {
    const design = loadStoredFreeformLabelDesign({
      settingsKey: options.settingsKey,
      presetsKey: options.presetsKey,
      kind: entityType,
    })
    controller.reset(design)
    syncGeometry()
    domBinding?.sync()
    void domBinding?.refresh()
  }
  const updateGeometry = () => {
    if (!editorEditable) {
      syncGeometry()
      return
    }
    controller.updateLabel({
      widthMm: Number(width?.value),
      heightMm: Number(height?.value),
      marginMm: Number(margin?.value),
      border: border?.checked ?? false,
    })
    syncGeometry()
    domBinding?.sync()
    void domBinding?.refresh()
  }

  for (const control of [width, height, margin, border]) listen(control, 'change', updateGeometry)
  listen<MouseEvent>(presetLoad, 'click', () => {
    if (!editorEditable) return
    const preset = selectedPreset()
    if (!preset) return
    controller.reset(preset.data.design)
    persistFreeformLabelDesign(options.settingsKey, preset.data.design)
    lastPersisted = JSON.stringify(preset.data.design)
    if (presetName) presetName.value = preset.name
    syncGeometry()
    domBinding?.sync()
    void domBinding?.refresh()
    setStatus(options.translate?.('labelDesigner.presetLoaded', 'Preset loaded.') ?? 'Preset loaded.')
  })
  listen<MouseEvent>(presetSave, 'click', () => {
    if (!editorEditable) return
    const name = presetName?.value.trim() ?? ''
    if (!name) {
      setStatus(options.translate?.('labelDesigner.presetNameRequired', 'Enter a preset name.') ?? 'Enter a preset name.')
      presetName?.focus()
      return
    }
    const design = controller.getState().design
    void enqueuePresetMutation(async () => {
      const presets = readStoredPresets(options.presetsKey)
      const index = presets.findIndex(candidate => candidate.name === name)
      const existing = index >= 0 ? presets[index] : null
      const data: LabelDesignerPresetData = { version: 2, design }
      if (existing && 'legacy_v1' in existing.data) data.legacy_v1 = clone(existing.data.legacy_v1)
      const preset: StoredPreset = { name, data, settings: existing?.settings }
      if (index >= 0) presets[index] = preset
      else presets.push(preset)
      return persistStoredPresetMutation(
        options.presetsKey,
        presets,
        () => saveLabelPreset(options.presetsKey, preset),
      )
    }).then(saved => {
      refreshPresetList(saved ? name : undefined)
      setStatus(saved
        ? (options.translate?.('labelDesigner.presetSaved', 'Preset saved.') ?? 'Preset saved.')
        : (options.translate?.('labelDesigner.presetSaveFailed', 'Preset save failed.') ?? 'Preset save failed.'))
    }, () => {
      refreshPresetList()
      setStatus(options.translate?.('labelDesigner.presetSaveFailed', 'Preset save failed.') ?? 'Preset save failed.')
    })
  })
  listen<MouseEvent>(presetDelete, 'click', () => {
    if (!editorEditable) return
    const value = presetSelect?.value ?? ''
    if (!value.startsWith('own:')) return
    const name = value.slice(4)
    void enqueuePresetMutation(() => persistStoredPresetMutation(
      options.presetsKey,
      readStoredPresets(options.presetsKey).filter(preset => preset.name !== name),
      () => deleteLabelPreset(options.presetsKey, name),
    )).then(deleted => {
      refreshPresetList()
      setStatus(deleted
        ? (options.translate?.('labelDesigner.presetDeleted', 'Preset deleted.') ?? 'Preset deleted.')
        : (options.translate?.('labelDesigner.presetDeleteFailed', 'Preset delete failed.') ?? 'Preset delete failed.'))
    }, () => {
      refreshPresetList()
      setStatus(options.translate?.('labelDesigner.presetDeleteFailed', 'Preset delete failed.') ?? 'Preset delete failed.')
    })
  })

  const syncMobileState = (availableWidth = measuredWorkspaceWidth()) => {
    const nextEditable = availableWidth > FREEFORM_EDITOR_BREAKPOINT_PX
    if (mobileNotice) mobileNotice.hidden = nextEditable
    if (workspace) workspace.dataset.editorEditable = String(nextEditable)
    const changed = nextEditable !== editorEditable
    editorEditable = nextEditable
    syncSidebarMutationControls()
    if (changed) void domBinding?.setEditable(nextEditable)
  }
  if (editorContainer && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(entries => {
      if (destroyed) return
      const entry = entries.find(candidate => candidate.target === editorContainer) ?? entries[0]
      syncMobileState(entry?.contentRect.width ?? measuredWorkspaceWidth())
    })
    resizeObserver.observe(editorContainer)
  } else {
    listen(window, 'resize', () => syncMobileState())
  }
  renderExtraFields()
  syncGeometry()
  refreshPresetList()
  syncMobileState()
  domBinding = bindFreeformEditorDom({
    root: document,
    controller,
    editable: editorEditable,
    loadInteract: options.loadInteract,
    translate: options.translate,
  })

  return {
    getDesign: () => controller.getState().design,
    loadSettings,
    refresh: () => domBinding?.refresh() ?? Promise.resolve(),
    refreshInteractions: () => domBinding?.refreshInteractions() ?? Promise.resolve(),
    refreshExtraFields(next) {
      extraFields = next
      renderExtraFields()
      domBinding?.sync()
    },
    refreshPresetList,
    refreshTokenAreas: renderExtraFields,
    destroy() {
      destroyed = true
      resizeObserver?.disconnect()
      domBinding?.destroy()
      cleanups.splice(0).forEach(cleanup => cleanup())
      if (activeEditors.get(options.settingsKey) === controller) activeEditors.delete(options.settingsKey)
    },
  }
}
