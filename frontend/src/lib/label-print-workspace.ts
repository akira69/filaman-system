import {
  getFreeformLabelPresetNames,
  initFreeformLabelDesignerEditor,
  loadFreeformLabelDesign,
  loadFreeformLabelPresetDesign,
  persistFreeformLabelDesign,
  type FreeformLabelDesignerEditorOptions,
} from './freeform-label/editor-controller'
import type { LabelKind } from './freeform-label/types'
import { bindPrintWorkspaceTabs, type LabelOutputControls, type PrintWorkspaceMode } from './label-print-page'
import type { LabelSheetControls, LabelSheetSource } from './label-sheet'

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
  sheetControls: Pick<LabelSheetControls, 'setDesignerPresets'>
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
    persistFreeformLabelDesign(options.settingsKey, design)
    editor.loadSettings()
    activateDesigner()
  }, { signal: events.signal })

  return {
    ...editor,
    destroy() {
      events.abort()
      editor.destroy()
    },
  }
}
