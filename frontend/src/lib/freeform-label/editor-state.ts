import { createDefaultLabelDesign } from './defaults'
import { createLabelHistory } from './history'
import { normalizeElement, normalizeLabelDesign, parseLabelElementJson } from './normalize'
import { wrapTemplateToken } from './text-modifiers'
import { localizedErrorMessage } from './editor-types'
import { clampElementPosition } from './geometry'
import type {
  FreeformEditorOptions,
  FreeformEditorState,
  JsonApplyResult,
  LabelAssetMetadata,
  LabelFieldModifier,
} from './editor-types'
import type {
  LabelDesignElement,
  LabelDesignV2,
  LabelElementIdFactory,
  LabelElementType,
  LabelImageElement,
  LabelShape,
  LabelShapeElement,
  LabelTextElement,
} from './types'

const defaultId: LabelElementIdFactory = () => crypto.randomUUID()

const jsonErrorKeys = new Map<string, string>([
  ['Element JSON must be valid JSON', 'labelDesigner.jsonInvalid'],
  ['Element JSON must contain an object', 'labelDesigner.jsonMustBeObject'],
  ['Element id cannot be changed', 'labelDesigner.jsonIdImmutable'],
  ['Element type cannot be changed', 'labelDesigner.jsonTypeImmutable'],
  ['Element type is not supported', 'labelDesigner.jsonUnsupportedType'],
])

function nextZ(design: LabelDesignV2) {
  return design.elements.length
}

function createElement(
  type: LabelElementType,
  design: LabelDesignV2,
  id: string,
  shape: LabelShape = 'rectangle',
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
        ...center(shape === 'line' ? 25 : shape === 'rectangle' ? 20 : 15, shape === 'line' ? 0.3 : shape === 'rectangle' ? 10 : 15),
        z,
        shape,
        fill: '',
        stroke: '#000000',
        strokeWidthMm: 0.3,
        radiusMm: 0,
      }
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
  let destroyed = false
  let templateSelection = { start: 0, end: 0 }
  // History already owns the committed snapshot. Accumulate live movement here
  // without copying the design into history or notifying persistence per move.
  let gestureActive = false
  let gestureChanged = false
  let notificationPending = false

  const getState = (): FreeformEditorState => ({
    design: structuredClone(design),
    selectedId,
    assets: structuredClone(assets),
    assetsLoading,
    assetError,
    destroyed,
  })

  const publish = () => {
    if (gestureActive) {
      // Async assets/render completions must respect the same commit boundary.
      notificationPending = true
      return
    }
    if (!destroyed) options.onChange?.(getState())
  }

  const endGesture = () => {
    if (!gestureActive) return false
    gestureActive = false
    const changed = gestureChanged
    const shouldPublish = gestureChanged || notificationPending
    if (gestureChanged) history.push(design)
    gestureChanged = false
    notificationPending = false
    if (shouldPublish) publish()
    return changed
  }

  const replaceDesign = (next: LabelDesignV2) => {
    endGesture()
    design = normalizeLabelDesign(next, { createId })
    history.push(design)
    if (selectedId && !design.elements.some(element => element.id === selectedId)) {
      selectedId = design.elements.at(-1)?.id ?? null
    }
    publish()
    return structuredClone(design)
  }

  const getSelectedElement = () => (
    design.elements.find(element => element.id === selectedId) ?? null
  )

  const select = (elementId: string | null) => {
    if (elementId !== selectedId) endGesture()
    selectedId = elementId && design.elements.some(element => element.id === elementId)
      ? elementId
      : null
    templateSelection = { start: 0, end: 0 }
    publish()
    return getSelectedElement()
  }

  const addElement = (type: LabelElementType, shape: LabelShape = 'rectangle') => {
    const element = createElement(type, design, createId(), shape)
    replaceDesign({ ...design, elements: [...design.elements, element] })
    selectedId = element.id
    publish()
    return structuredClone(getSelectedElement()!)
  }

  const updateElement = (elementId: string, changes: Partial<LabelDesignElement>) => {
    const nextElements = design.elements.map(element => {
      if (element.id !== elementId) return element
      const square = element.type === 'shape' && (element.shape === 'circle' || element.shape === 'square')
      const dimensions = square && changes.h !== undefined && changes.w === undefined ? { w: changes.h } : {}
      const strokeChanges: Partial<LabelShapeElement> = {}
      if (element.type === 'shape' && 'strokeWidthMm' in changes && typeof changes.strokeWidthMm === 'number' && Number.isFinite(changes.strokeWidthMm)) {
        const thickness = Math.min(10, Math.max(0, changes.strokeWidthMm))
        if (thickness > 0 && !element.stroke) strokeChanges.stroke = '#000000'
        if (element.shape === 'line') {
          strokeChanges.h = Math.max(0.1, thickness)
          strokeChanges.y = element.y + (element.h - strokeChanges.h) / 2
        }
      }
      const cropChanges = element.type === 'image' && 'assetId' in changes && changes.assetId !== element.assetId ? { crop: undefined } : {}
      return { ...element, ...changes, ...dimensions, ...strokeChanges, ...cropChanges, id: element.id, type: element.type } as LabelDesignElement
    })
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

  const pasteElement = (source: Record<string, unknown>) => {
    const selected = normalizeElement(source, design.label, nextZ(design))
    if (!selected) return null
    const position = clampElementPosition({
      x: selected.x + 2,
      y: selected.y + 2,
      w: selected.w,
      h: selected.h,
    }, design.label)
    const copy = {
      ...structuredClone(selected),
      id: createId(),
      ...position,
      z: nextZ(design),
    } as LabelDesignElement
    replaceDesign({ ...design, elements: [...design.elements, copy] })
    selectedId = copy.id
    publish()
    return structuredClone(getSelectedElement()!)
  }

  const duplicateSelected = () => {
    const selected = getSelectedElement()
    return selected ? pasteElement({ ...selected }) : null
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
    const inserted = wrapTemplateToken(token, modifier)
    let selected = getSelectedElement()
    if (selected?.type !== 'text') {
      selected = addElement('text')
      updateSelected({ template: inserted })
      return structuredClone(getSelectedElement() as LabelTextElement)
    }
    const start = Math.min(templateSelection.start, selected.template.length)
    const end = Math.min(Math.max(templateSelection.end, start), selected.template.length)
    const template = `${selected.template.slice(0, start)}${inserted}${selected.template.slice(end)}`
    updateSelected({ template })
    templateSelection = { start: start + inserted.length, end: start + inserted.length }
    return structuredClone(getSelectedElement() as LabelTextElement)
  }

  const loadAssets = async () => {
    if (!options.assets) return []
    assetsLoading = true
    assetError = null
    publish()
    try {
      assets = await options.assets.list()
      return structuredClone(assets)
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
    return structuredClone(asset)
  }

  const deleteAsset = async (assetId: string) => {
    if (!options.assets) throw new Error(translate('labelDesigner.imageDeleteUnavailable', 'Label image deletion is unavailable'))
    await options.assets.delete(assetId)
    assets = assets.filter(asset => asset.id !== assetId)
    publish()
  }

  const requestRender = async () => {
    if (!destroyed) await options.render?.(structuredClone(design))
  }

  return {
    getState,
    getDesign: () => structuredClone(design),
    getAssets: () => structuredClone(assets),
    isDestroyed: () => destroyed,
    getSelectedId: () => selectedId,
    getLabel: () => ({ ...design.label }),
    getElement: (elementId: string) => structuredClone(design.elements.find(element => element.id === elementId) ?? null),
    getMaxZ: () => Math.max(0, ...design.elements.map(element => element.z)),
    getSelectedElement: () => structuredClone(getSelectedElement()),
    getSelectedJson,
    select,
    clearSelection: () => select(null),
    addElement,
    addImage(assetId: string): LabelImageElement {
      addElement('image')
      updateSelected({ assetId })
      return structuredClone(getSelectedElement() as LabelImageElement)
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
    pasteElement,
    moveSelected,
    nudgeSelected,
    applySelectedJson,
    setTemplateSelection(start: number, end = start) {
      templateSelection = { start: Math.max(0, start), end: Math.max(0, end) }
    },
    getTemplateSelection: () => ({ ...templateSelection }),
    insertField,
    loadAssets,
    uploadAsset,
    deleteAsset,
    requestRender,
    beginGesture() {
      if (!destroyed) gestureActive = true
    },
    updateGesture(elementId: string, changes: Partial<LabelDesignElement>) {
      if (destroyed) return
      const index = design.elements.findIndex(element => element.id === elementId)
      if (index < 0) return
      const current = design.elements[index]
      const next = normalizeElement({ ...current, ...changes, id: current.id, type: current.type }, design.label, current.z)
      if (!next || Object.entries(next).every(([key, value]) => current[key as keyof LabelDesignElement] === value)) return
      gestureActive = true
      const elements = [...design.elements]
      elements[index] = next
      design = { ...design, elements }
      gestureChanged = true
    },
    endGesture,
    undo() {
      endGesture()
      design = history.undo()
      publish()
      return structuredClone(design)
    },
    redo() {
      endGesture()
      design = history.redo()
      publish()
      return structuredClone(design)
    },
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    reset(next: LabelDesignV2) {
      endGesture()
      design = normalizeLabelDesign(next, { createId })
      history.reset(design)
      selectedId = design.elements[0]?.id ?? null
      publish()
    },
    destroy() {
      endGesture()
      destroyed = true
    },
  }
}

export type FreeformEditorController = ReturnType<typeof createFreeformEditorController>
