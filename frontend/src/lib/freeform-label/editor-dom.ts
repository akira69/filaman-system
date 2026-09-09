import { bindCanvasTextEditor } from './canvas-text-editor'
import { bindElementClipboard } from './element-clipboard'
import { bindFieldDrawer } from './field-drawer'
import { bindShapeMenu } from './shape-menu'
import { bindImageCropEditor } from './image-crop-editor'
import { bindLabelInteractions, type InteractFactory, type LabelInteractionController } from './interaction-adapter'
import { formatDesignerNumber } from './number-format'
import { wrapTemplateToken } from './text-modifiers'
import {
  getQrRecommendedSideMm,
  QR_QUIET_ZONE_MODULES,
  QR_RECOMMENDED_DPI,
} from './qr-readability'
import type { FreeformEditorController } from './editor-state'
import { elementLabelKeys, elementLabelFallbacks, localizedErrorMessage, type LabelFieldModifier } from './editor-types'
import { LABEL_SHAPES, type LabelDesignElement, type LabelElementType } from './types'

export interface BindFreeformEditorDomOptions {
  root?: ParentNode
  controller: FreeformEditorController
  editable?: boolean
  loadInteract?: () => Promise<InteractFactory>
  translate?: (key: string, fallback: string) => string
}

const elementProperties = [
  'x', 'y', 'w', 'h', 'template', 'fontFamily', 'fontSizeMm',
  'fontWeight', 'align', 'assetId', 'mode', 'strokeWidthMm', 'wrap', 'fitToWidth', 'minFontSizeMm',
] as const
function isElementProperty(value: string): value is typeof elementProperties[number] {
  return elementProperties.some(property => property === value)
}

export function bindFreeformEditorDom(options: BindFreeformEditorDomOptions) {
  const root = options.root ?? document
  const controller = options.controller
  const cleanups: Array<() => void> = []
  let interaction: LabelInteractionController | null = null
  let editable = options.editable !== false
  let destroyed = false
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
  const fieldDrawer = bindFieldDrawer(root)
  let interactionRoot: HTMLElement | null = null
  let interactionGeneration = 0

  const syncQrReadability = () => {
    const recommendation = query<HTMLElement>('#freeform-qr-readability-recommendation')
    const warning = query<HTMLElement>('#freeform-qr-readability-warning')
    const note = query<HTMLElement>('#freeform-qr-readability-note')
    const selected = controller.getSelectedElement()
    if (!recommendation || !warning) return
    if (note) {
      note.textContent = translate(
        'labelDesigner.qrReadabilityNote',
        'Keep {modules} modules of white clear space around the code and make a test print. This advisory does not guarantee scanning.',
      ).replace('{modules}', String(QR_QUIET_ZONE_MODULES))
    }
    if (selected?.type !== 'qr') {
      warning.hidden = true
      warning.textContent = ''
      return
    }
    const moduleCounts = queryAll<HTMLElement>('[data-qr-module-count]')
      .filter(node => node.dataset.labelElementId === selected.id)
      .map(node => Number(node.dataset.qrModuleCount))
      .filter(value => Number.isInteger(value) && value > 0)
    const recommendedMm = getQrRecommendedSideMm(moduleCounts.length ? Math.max(...moduleCounts) : undefined)
    if (recommendedMm === undefined) {
      recommendation.textContent = translate(
        'labelDesigner.qrReadabilityUnavailable',
        '{dpi} DPI size guidance appears after the code is rendered.',
      ).replace('{dpi}', String(QR_RECOMMENDED_DPI))
      warning.hidden = true
      warning.textContent = ''
      return
    }
    const formatted = formatDesignerNumber(recommendedMm)
    recommendation.textContent = translate(
      'labelDesigner.qrReadabilityRecommendation',
      'At {dpi} DPI, use at least {size} mm for this encoded QR.',
    ).replace('{dpi}', String(QR_RECOMMENDED_DPI)).replace('{size}', formatted)
    const undersized = Math.min(selected.w, selected.h) < recommendedMm
    warning.textContent = undersized
      ? translate(
          'labelDesigner.qrReadabilityWarning',
          'This QR is below the recommended {size} mm at {dpi} DPI.',
        ).replace('{dpi}', String(QR_RECOMMENDED_DPI)).replace('{size}', formatted)
      : ''
    warning.hidden = !undersized
  }

  const syncDom = () => {
    const selectedId = controller.getSelectedId()
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
    queryAll<HTMLButtonElement>('[data-element-align], [data-element-vertical-align]').forEach(button => {
      const active = selected?.type === 'text' && (button.dataset.elementAlign
        ? selected.align === button.dataset.elementAlign
        : (selected.verticalAlign ?? 'top') === button.dataset.elementVerticalAlign)
      button.setAttribute('aria-pressed', String(active))
      button.disabled = !editable || selected?.type !== 'text'
    })
    queryAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-element-prop]').forEach(input => {
      const property = input.dataset.elementProp
      if (!selected || !property || !isElementProperty(property)) return
      const value: unknown = property === 'minFontSizeMm' && selected.type === 'text'
        ? selected.minFontSizeMm ?? (selected.wrap ? Math.min(2, selected.fontSizeMm) : 0.265)
        : Reflect.get(selected, property)
      if (input instanceof HTMLInputElement && input.type === 'radio') {
        input.checked = input.value === value
      } else if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = value === true
      } else if (typeof value === 'number') {
        input.value = formatDesignerNumber(value)
      } else if (typeof value === 'string') {
        input.value = value
      }
    })
    const fitSettings = query<HTMLElement>('#freeform-fit-settings')
    if (fitSettings) fitSettings.hidden = selected?.type !== 'text' || !selected.fitToWidth
    const minimumSize = query<HTMLInputElement>('[data-element-prop="minFontSizeMm"]')
    if (minimumSize && selected?.type === 'text') minimumSize.max = String(selected.fontSizeMm)
    const wrapHint = query<HTMLElement>('#freeform-wrap-limit-hint')
    if (wrapHint) wrapHint.hidden = selected?.type !== 'text' || !selected.wrap
    const fitWarning = query<HTMLElement>('#freeform-text-fit-warning')
    if (fitWarning) {
      const failed = selected?.type === 'text'
        ? queryAll<HTMLElement>('[data-label-output-error]').find(node => node.dataset.labelElementId === selected.id)
        : undefined
      fitWarning.hidden = !failed
      fitWarning.textContent = failed?.dataset.labelOutputError ?? ''
    }
    const json = query<HTMLTextAreaElement>('#freeform-element-json')
    if (json && document.activeElement !== json) json.value = controller.getSelectedJson()
    const template = query<HTMLTextAreaElement>('#freeform-template')
    if (template && selected?.type === 'text' && document.activeElement !== template) {
      template.value = selected.template
    }
    const imageSelect = query<HTMLSelectElement>('#freeform-image-asset')
    if (imageSelect) {
      const current = selected?.type === 'image' ? selected.assetId : ''
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = translate('labelDesigner.chooseImage', 'Choose an image')
      placeholder.disabled = true
      imageSelect.replaceChildren(
        placeholder,
        ...controller.getAssets().map(asset => {
          const option = document.createElement('option')
          option.value = asset.id
          option.textContent = asset.display_name
          option.selected = asset.id === current
          return option
        }),
      )
      imageSelect.value = current
    }
    queryAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>([
      '[data-designer-add]',
      '[data-shape-menu-trigger]',
      '[data-designer-shape]',
      '[data-designer-action]',
      '[data-element-prop]',
      '[data-field-modifier]',
      '[data-field-token]',
      '#freeform-json-apply',
      '#freeform-image-upload',
      '#freeform-image-upload-trigger',
      '#freeform-image-delete',
    ].join(',')).forEach(control => { control.disabled = !editable })
    queryAll<HTMLButtonElement>('[data-requires-selection]').forEach(button => { button.disabled = !editable || !selected })
    const imageDelete = query<HTMLButtonElement>('#freeform-image-delete')
    if (imageDelete) imageDelete.disabled = !editable || selected?.type !== 'image' || !selected.assetId
    queryAll<HTMLButtonElement>('[data-designer-action="undo"]').forEach(button => { button.disabled = !editable || !controller.canUndo() })
    queryAll<HTMLButtonElement>('[data-designer-action="redo"]').forEach(button => { button.disabled = !editable || !controller.canRedo() })
    canvasHost?.setAttribute('aria-readonly', String(!editable))
    if (workspace) workspace.dataset.editorEditable = String(editable)
    for (const chrome of queryAll<HTMLElement>('.freeform-toolbar, #freeform-element-inspector, #freeform-field-dock')) {
      chrome.toggleAttribute('inert', !editable)
      chrome.toggleAttribute('aria-hidden', !editable)
    }
    fieldDrawer.update(selected?.type === 'text' ? selected.id : undefined, editable)
    queryAll<HTMLElement>('[data-label-element-id]').forEach(element => {
      element.classList.toggle('is-selected', editable && element.dataset.labelElementId === selectedId)
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
    syncQrReadability()
    textEditor?.sync()
    cropEditor?.sync()
    interaction?.syncSelection()
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
    const isCurrent = () => generation === interactionGeneration
      && editable && !controller.isDestroyed()
      && canvas === canvasHost?.querySelector('.label-preview')
    const next = await bindLabelInteractions({
      root: canvas,
      getDesign: controller.getDesign,
      getSelectedId: controller.getSelectedId,
      getLabel: controller.getLabel,
      getElement: controller.getElement,
      getMaxZ: controller.getMaxZ,
      editable: true,
      onSelect: elementId => {
        controller.select(elementId)
        syncDom()
      },
      onGeometryChange: (elementId, geometry) => {
        controller.updateGesture(elementId, geometry)
        syncQrReadability()
        textEditor?.positionToolbar()
      },
      onGestureStart: () => {
        controller.beginGesture()
        textEditor?.setGestureActive(true)
      },
      onGestureEnd: () => {
        const changed = controller.endGesture()
        textEditor?.setGestureActive(false)
        syncDom()
        if (changed && !destroyed) void refresh()
      },
      loadInteract: options.loadInteract,
      shouldInitialize: isCurrent,
    })
    if (!isCurrent()) {
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
      if (focusAfter === 'selected') focusElement(controller.getSelectedId())
      if (focusAfter === 'canvas') focusElement(null)
    })
  }

  queryAll<HTMLButtonElement>('[data-designer-add]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const type = button.dataset.designerAdd as LabelElementType | undefined
      if (type) mutate(() => controller.addElement(type))
    })
  })

  const shapeMenu = bindShapeMenu(root)
  queryAll<HTMLButtonElement>('[data-designer-shape]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const shape = LABEL_SHAPES.find(candidate => candidate === button.dataset.designerShape)
      if (editable && shape) mutate(() => controller.addElement('shape', shape), 'selected')
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
      if (!editable || (input instanceof HTMLInputElement && input.type === 'radio' && !input.checked)) return
      const property = input.dataset.elementProp
      if (!property || !isElementProperty(property)) return
      const selected = controller.getSelectedElement()
      const numeric = ['x', 'y', 'w', 'h', 'fontSizeMm', 'minFontSizeMm', 'fontWeight', 'strokeWidthMm'].includes(property)
      mutate(() => controller.updateSelected({
        [property]: input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked : numeric ? Number(input.value) : input.value,
        ...(property === 'fitToWidth' && input instanceof HTMLInputElement && input.checked
          ? { minFontSizeMm: selected?.type === 'text'
            ? selected.minFontSizeMm ?? Math.min(2, selected.fontSizeMm) : 2 } : {}),
      } as Partial<LabelDesignElement>))
    })
  })

  queryAll<HTMLButtonElement>('[data-element-align], [data-element-vertical-align]').forEach(button => {
    listen(button, 'click', () => {
      const align = button.dataset.elementAlign
      const verticalAlign = button.dataset.elementVerticalAlign
      if (controller.getSelectedElement()?.type === 'text' && (align === 'left' || align === 'center' || align === 'right')) {
        mutate(() => controller.updateSelected({ align }))
      } else if (controller.getSelectedElement()?.type === 'text' && (verticalAlign === 'top' || verticalAlign === 'middle' || verticalAlign === 'bottom')) {
        mutate(() => controller.updateSelected({ verticalAlign }))
      }
    })
  })

  cleanups.push(bindElementClipboard({
    canvas: canvasHost,
    isEditable: () => editable,
    getSelected: controller.getSelectedElement,
    paste: source => {
      const inserted = controller.pasteElement(source)
      if (!inserted) return false
      syncDom()
      void refresh().then(() => focusElement(inserted.id))
      return true
    },
  }))

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

  const textEditor = bindCanvasTextEditor({
    root,
    getSelected: controller.getSelectedElement,
    getTemplateRange: controller.getTemplateSelection,
    setTemplateRange: range => controller.setTemplateSelection(range.start, range.end),
    resetTemplateRange: () => controller.setTemplateSelection(0, 0),
    isEditable: () => editable,
    select: id => {
      if (controller.getSelectedId() !== id) controller.select(id)
      syncDom()
    },
    updateTemplate: (value, range) => {
      controller.updateSelected({ template: value })
      controller.setTemplateSelection(range.start, range.end)
    },
    refresh,
    refreshInteractions: refreshInteraction,
  })

  const cropEditor = bindImageCropEditor({
    root,
    controller,
    isEditable: () => editable,
    onChange: () => { syncDom(); void refresh() },
    translate,
  })

  queryAll<HTMLButtonElement>('[data-field-modifier]').forEach(button => {
    listen<MouseEvent>(button, 'click', () => {
      const modifier = button.dataset.fieldModifier as LabelFieldModifier
      if (!editable) return
      if (textEditor?.format(modifier, false)) return
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
    if (!editable) return
    const insertedInCanvas = textEditor.insertField(activeModifier ? wrapTemplateToken(token, activeModifier) : token)
    if (!insertedInCanvas) mutate(() => controller.insertField(token, activeModifier))
    activeModifier = null
    queryAll<HTMLButtonElement>('[data-field-modifier]').forEach(candidate => candidate.setAttribute('aria-pressed', 'false'))
  })

  const fieldTabs = queryAll<HTMLButtonElement>('[data-field-group-tab]').filter(button => !button.hidden)
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
  listen<MouseEvent>(query('#freeform-image-upload-trigger'), 'click', () => {
    if (editable && controller.getSelectedElement()?.type === 'image') upload?.click()
  })
  listen<Event>(upload, 'change', () => {
    if (!editable) return
    const file = upload?.files?.[0]
    if (!file) return
    const target = controller.getSelectedElement()
    if (target?.type !== 'image') return
    void controller.uploadAsset(file).then(asset => {
      if (controller.isDestroyed() || !editable) return
      if (controller.getElement(target.id)?.type === 'image') {
        controller.updateElement(target.id, { assetId: asset.id })
      }
      const status = query<HTMLElement>('#freeform-image-status')
      if (status) status.textContent = ''
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
    }).finally(() => { if (upload) upload.value = '' })
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
    if (textEditor?.handleKeydown(event)) return
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
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      mutate(() => controller.redo())
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
  listen<MouseEvent>(canvasHost, 'click', event => {
    if (!editable) return
    const frame = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-label-selection-for]')
      : null
    if (frame?.dataset.labelSelectionFor) focusElement(frame.dataset.labelSelectionFor)
  })

  // Dismiss on the initial press, not release, so dragging outside the label
  // still finishes normally. Inspector and formatting controls retain selection.
  listen<PointerEvent>(canvasHost?.ownerDocument, 'pointerdown', event => {
    if (!editable || !controller.getSelectedId() || !(event.target instanceof Element)) return
    const target = event.target
    if (canvasHost?.contains(target) && target.closest('[data-label-element-id], [data-label-selection-for]')) return
    const editingControl = target.closest('.freeform-command-bar, .freeform-toolbar, #freeform-element-inspector, #freeform-field-dock, .freeform-text-toolbar, .freeform-shape-menu')
    if (editingControl && root.contains(editingControl)) return
    const selection = canvasHost?.ownerDocument.getSelection()
    if (selection?.anchorNode && canvasHost?.contains(selection.anchorNode)) selection.removeAllRanges()
    const focused = canvasHost?.ownerDocument.activeElement
    if (focused instanceof HTMLElement && canvasHost?.contains(focused)) focused.blur()
    controller.clearSelection()
    syncDom()
  })

  syncDom()
  const ready = refresh()
  void controller.loadAssets().then(syncDom).catch(() => syncDom())

  return {
    ready,
    refresh,
    async refreshInteractions() {
      await refreshInteraction()
      syncDom()
    },
    sync: syncDom,
    async setEditable(next: boolean) {
      editable = next
      syncDom()
      await refreshInteraction()
      syncDom()
    },
    destroy() {
      destroyed = true
      interactionGeneration += 1
      textEditor?.destroy()
      fieldDrawer.destroy()
      cropEditor?.destroy()
      shapeMenu.destroy()
      interaction?.destroy()
      cleanups.splice(0).forEach(cleanup => cleanup())
      controller.destroy()
    },
  }
}
