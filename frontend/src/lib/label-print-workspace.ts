import {
  getFreeformLabelPresetNames,
  initFreeformLabelDesignerEditor,
  loadFreeformLabelDesign,
  loadFreeformLabelPresetDesign,
  type FreeformLabelDesignerEditorOptions,
} from './freeform-label/editor-controller'
import type { LabelKind } from './freeform-label/types'
import { bindPrintWorkspaceTabs, type createPrintWorkspaceCoordinator, type LabelOutputControls, type PrintWorkspaceMode } from './label-print-page'
import { resizeLabelDesign } from './freeform-label/geometry'
import type { SheetLabelSetup, LabelSheetControls, LabelSheetSource } from './label-sheet'
import { getAbortSignal } from './abort'
import { t } from './i18n'

export function bindDesignerPreviewNavigation<T>(workspace: ReturnType<typeof createPrintWorkspaceCoordinator<T>>) {
  const navigation = document.getElementById('freeform-preview-navigation')
  const buttons = navigation?.querySelectorAll<HTMLButtonElement>('[data-preview-step]') ?? []
  const position = navigation?.querySelector('[data-preview-position]')
  const sync = () => {
    const { mode, previewIndex, outputItems } = workspace.getState()
    if (navigation) navigation.hidden = mode !== 'designer' || outputItems.length <= 1
    if (position) position.textContent = t('labelDesigner.previewPosition', {
      current: String(previewIndex + 1), total: String(outputItems.length),
    })
    buttons.forEach(button => {
      button.disabled = Number(button.dataset.previewStep) < 0 ? previewIndex === 0 : previewIndex >= outputItems.length - 1
    })
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    workspace.selectPreview(workspace.getState().previewIndex + Number(button.dataset.previewStep))
    sync()
  }, { signal: getAbortSignal() }))
  sync()
  return sync
}

export function bindLabelPrintWorkspaceTabs(options: {
  sheetControls: LabelSheetControls
  outputControls: LabelOutputControls
  storageKey: string
  initialMode: PrintWorkspaceMode
  onChange: (mode: PrintWorkspaceMode) => void
}) {
  return bindPrintWorkspaceTabs({
    ...options,
    buttons: document.querySelectorAll<HTMLButtonElement>('.tab-btn'),
    panels: {
      standard: document.getElementById('tab-panel-print')!,
      designer: document.getElementById('tab-panel-designer-v2')!,
      sheets: document.getElementById('tab-panel-sheets')!,
    },
    outputButtons: {
      print: options.outputControls.printButton,
      pdf: options.outputControls.pdfButton,
      png: options.outputControls.pngButton,
      aml: options.outputControls.amlButton,
    },
    resetButton: document.getElementById('btn-reset'),
    sidebar: document.querySelector<HTMLElement>('.print-sidebar'),
    designerWorkspace: document.getElementById('freeform-designer-workspace'),
  })
}

export function getPrintDesignerDesign(options: {
  settingsKey: string
  presetsKey: string
  kind: LabelKind
  mode: PrintWorkspaceMode
  sheetSource: LabelSheetSource
}) {
  if (options.mode === 'sheets' && options.sheetSource.type === 'designer' && options.sheetSource.presetName) {
    const preset = loadFreeformLabelPresetDesign({ ...options, presetName: options.sheetSource.presetName })
    if (preset) return preset
  }
  return loadFreeformLabelDesign(options)
}

export async function initPrintDesignerEditor(options: FreeformLabelDesignerEditorOptions & {
  sheetControls: Pick<LabelSheetControls, 'setDesignerPresets' | 'setSource'>
  activateDesigner: () => void
}) {
  const { sheetControls, activateDesigner, ...editorOptions } = options
  const events = new AbortController()
  window.addEventListener('pagehide', () => events.abort(), { once: true, signal: events.signal })
  document.addEventListener('freeform-label-presets-changed', event => {
    const names = (event as CustomEvent<{ presets?: string[] }>).detail?.presets
    if (Array.isArray(names)) sheetControls.setDesignerPresets(names)
  }, { signal: events.signal })

  let editor: Awaited<ReturnType<typeof initFreeformLabelDesignerEditor>>
  try {
    editor = await initFreeformLabelDesignerEditor(editorOptions)
  } catch (error) {
    events.abort()
    throw error
  }
  sheetControls.setDesignerPresets(getFreeformLabelPresetNames(options.presetsKey))
  document.addEventListener('label-designer-edit', event => {
    const presetName = (event as CustomEvent<{ presetName?: string }>).detail?.presetName
    const design = presetName
      ? loadFreeformLabelPresetDesign({
        presetsKey: options.presetsKey,
        presetName,
        kind: options.entityType ?? 'spool',
      })
      : null
    if (!design) return
    editor.loadSettings(design)
    activateDesigner()
  }, { signal: events.signal })

  const returnButtons = document.querySelectorAll<HTMLButtonElement>('[data-sheet-use]')
  const nameInput = document.getElementById('freeform-preset-name') as HTMLInputElement | null
  let suggestedName = ''
  let existingSheetPresetNames = new Set<string>()
  const activateTab = (mode: PrintWorkspaceMode) => document.querySelector<HTMLButtonElement>(`[data-workspace-mode="${mode}"]`)?.click()
  document.addEventListener('label-sheet-create', event => {
    const setup = (event as CustomEvent<SheetLabelSetup>).detail
    if (!setup || !Number.isFinite(setup.widthMm) || !Number.isFinite(setup.heightMm)) return
    if (setup.type === 'designer') {
      const source = loadFreeformLabelPresetDesign({
        presetsKey: options.presetsKey, presetName: setup.presetName, kind: options.entityType ?? 'spool',
      })
      if (!source) return
      editor.loadSettings(resizeLabelDesign(source, setup.widthMm, setup.heightMm))
      const names = getFreeformLabelPresetNames(options.presetsKey)
      existingSheetPresetNames = new Set(names)
      suggestedName = setup.name
      for (let suffix = 2; names.includes(suggestedName); suffix++) suggestedName = `${setup.name} (${suffix})`
      if (nameInput) nameInput.value = suggestedName
      activateDesigner()
    } else {
      const width = document.getElementById('input-width') as HTMLInputElement | null
      const height = document.getElementById('input-height') as HTMLInputElement | null
      if (width && height) {
        width.value = String(Number(setup.widthMm.toFixed(3)))
        height.value = String(Number(setup.heightMm.toFixed(3)))
        width.dispatchEvent(new Event('change', { bubbles: true }))
      }
      activateTab('standard')
    }
    returnButtons.forEach(button => { button.hidden = button.dataset.sheetUse !== setup.type })
  }, { signal: events.signal })
  nameInput?.addEventListener('focus', () => {
    if (nameInput.value === suggestedName) nameInput.select()
  }, { signal: events.signal })
  returnButtons.forEach(button => button.addEventListener('click', async () => {
    if (button.disabled) return
    button.disabled = true
    try {
      if (button.dataset.sheetUse === 'designer') {
        const name = await editor.savePreset(existingSheetPresetNames.has(nameInput?.value.trim() ?? ''))
        if (!name) return
        sheetControls.setDesignerPresets(getFreeformLabelPresetNames(options.presetsKey), name)
        sheetControls.setSource({ type: 'designer', presetName: name })
      } else sheetControls.setSource({ type: 'standard' })
      returnButtons.forEach(candidate => { candidate.hidden = true })
      activateTab('sheets')
    } finally { button.disabled = false }
  }, { signal: events.signal }))

  return {
    ...editor,
    destroy() {
      events.abort()
      editor.destroy()
    },
  }
}
