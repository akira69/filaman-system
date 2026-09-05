// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import LabelDesignerEditor from '../components/LabelDesignerEditor.astro'
import LabelSheetOutputSettings from '../components/LabelSheetOutputSettings.astro'
import PrintActionFooter from '../components/PrintActionFooter.astro'
import PrintSidebar from '../components/PrintSidebar.astro'

import {
  bindLabelSheetControls,
  renderLabelSheetPreview,
  syncLabelSheetIndividualExportState,
  type LabelSheetControls,
  type LabelSheetSettings,
} from './label-sheet'

const settings: LabelSheetSettings = {
  paperSize: 'custom',
  customWidthMm: 100,
  customHeightMm: 50,
  rows: 1,
  columns: 1,
  marginTopMm: 5,
  marginRightMm: 5,
  marginBottomMm: 5,
  marginLeftMm: 5,
  gapHorizontalMm: 0,
  gapVerticalMm: 0,
  skipCells: 0,
  copies: 1,
  showGrid: false,
  printGrid: false,
  fitToCell: true,
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = `
    <div id="preview">
      <div id="source"><div class="label-preview">Sample label</div></div>
    </div>
  `
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('label sheet preview styling', () => {
  it('injects screen-only CSS while preserving the configured sheet dimensions', () => {
    renderLabelSheetPreview({
      previewRoot: document.querySelector<HTMLElement>('#preview')!,
      sourceElements: [document.querySelector<HTMLElement>('#source')!],
      settings,
      labelWidthMm: 60,
      labelHeightMm: 40,
    })

    const style = document.querySelector<HTMLStyleElement>(
      '#label-sheet-preview-style',
    )

    expect(style).not.toBeNull()
    expect(style!.textContent).not.toContain('@media print')
    expect(style!.textContent).not.toContain('@page')
    expect(style!.textContent).toContain('width: 100mm')
    expect(style!.textContent).toContain('height: 50mm')
  })

  it('removes designer selection state and editor chrome from every sheet copy', () => {
    const source = document.querySelector<HTMLElement>('#source .label-preview')!
    source.classList.add('is-selected')
    source.setAttribute('data-label-interactive', '')
    source.insertAdjacentHTML('beforeend', '<span class="is-selected" data-label-interaction-bound>Element</span><button data-editor-handle>Resize</button>')

    renderLabelSheetPreview({
      previewRoot: document.querySelector<HTMLElement>('#preview')!,
      sourceElements: [document.querySelector<HTMLElement>('#source')!],
      settings: { ...settings, copies: 2 },
      labelWidthMm: 60,
      labelHeightMm: 40,
    })

    const copies = Array.from(document.querySelectorAll<HTMLElement>('.label-sheet-page .label-preview'))
    expect(copies).toHaveLength(2)
    expect(copies.every(copy => !copy.hasAttribute('data-label-interactive'))).toBe(true)
    expect(document.querySelector('.label-sheet-page .is-selected')).toBeNull()
    expect(document.querySelector('.label-sheet-page [data-label-interaction-bound]')).toBeNull()
    expect(document.querySelector('.label-sheet-page [data-editor-handle]')).toBeNull()
  })
})

describe('label sheet individual export state', () => {
  it('disables and restores PNG and AML together', () => {
    let mode: 'individual' | 'sheet' = 'sheet'
    const controls = {
      getOutputMode: () => mode,
    } as LabelSheetControls
    const png = document.createElement('button')
    const aml = document.createElement('button')
    png.title = 'PNG title'

    syncLabelSheetIndividualExportState(
      controls,
      [png, aml],
      (_key, fallback) => fallback,
    )

    for (const button of [png, aml]) {
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.classList.contains('is-disabled')).toBe(true)
      expect(button.title).toBe(
        'Individual PNG and AML exports are not available in label paper mode',
      )
    }

    mode = 'individual'
    syncLabelSheetIndividualExportState(
      controls,
      [png, aml],
      (_key, fallback) => fallback,
    )

    expect(png.disabled).toBe(false)
    expect(png.getAttribute('aria-disabled')).toBeNull()
    expect(png.classList.contains('is-disabled')).toBe(false)
    expect(png.title).toBe('PNG title')
    expect(aml.title).toBe('')
  })
})

describe('selectable print guidance translations', () => {
  it.each(['../i18n/en.json', '../i18n/de.json'])(
    '%s contains every print mode and AML status key',
    path => {
      const messages = JSON.parse(
        readFileSync(
          fileURLToPath(new URL(path, import.meta.url)),
          'utf8',
        ),
      )

      for (const key of [
        'temporaryPdfPreviewTitle',
        'backToLabelPreview',
        'openPdfForPrinting',
        'downloadPdf',
        'inlinePdfUnsupported',
        'printPopupBlocked',
      ]) {
        expect(messages.labelPrint[key]).toBeTruthy()
      }
      expect(messages.labelPrint.preparingPrintPdf).toBeUndefined()
      expect(messages.labelPrint.preparingBrowserPrint).toBeTruthy()
      expect(messages.labelPrint.printPdfFailed).toBeTruthy()
      expect(messages.labelPrint.browserPrintFailed).toBeTruthy()
      expect(messages.labelPrint.btnExportAml).toBeTruthy()
      expect(messages.labelPrint.amlExportFailed).toBeTruthy()
      expect(messages.labelPrint.createTemporaryPdf).toBeTruthy()
      expect(
        messages.labelPrint.individualExportsUnavailableInSheetMode,
      ).toBeTruthy()
      expect(messages.labelPrint.printHelpIntro).toBeTruthy()
      expect(messages.labelPrint.printHelpScale).toBeTruthy()
      expect(messages.labelPrint.printHelpBrowserSystemDialog).toBeTruthy()
      expect(messages.labelPrint.printHelpPdfFallbackPrefix).toBeTruthy()
      expect(messages.labelPrint.printHelpPdfFallbackSuffix).toBeTruthy()
      expect(messages.labelPrint.printHelpPdfOpenOnly).toBeTruthy()
      expect(messages.labelPrint.printHelpPdfSystemDialog).toBeTruthy()
      expect(messages.labelPrint.printHelpPdfDownloadSetting).toBeTruthy()
      expect(messages.labelPrint.printHelpViewer).toBeUndefined()
      expect(messages.labelPrint.printHelpBrave).toBeUndefined()
      expect(messages.labelPrint.printHelpFirefox).toBeUndefined()
    },
  )
})

describe('print guidance', () => {
  it('semantically emphasizes the temporary PDF option', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(PrintActionFooter)

    const temporaryPdfGuidance = document.querySelector(
      '#print-help-content [data-i18n="labelPrint.createTemporaryPdf"]',
    )

    expect(temporaryPdfGuidance?.tagName).toBe('EM')
    expect(temporaryPdfGuidance?.textContent?.trim()).toBe(
      'Create temporary PDF for printing',
    )
  })
})

describe('label designer template fields', () => {
  async function renderEditor() {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(LabelDesignerEditor)
  }

  it('renders multiline formats with at least five visible rows', async () => {
    await renderEditor()

    for (const id of ['ds-info-tpl', 'ds-info2-tpl']) {
      const input = document.querySelector<HTMLTextAreaElement>(`#${id}`)
      expect(input).toBeInstanceOf(HTMLTextAreaElement)
      expect(Number(input!.getAttribute('rows'))).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('first-class print workspace navigation', () => {
  it.each([
    { path: '../pages/spools/[id]/print.astro', config: 'PRINT_WORKSPACE_ROUTES.singleSpool' },
    { path: '../pages/spools/print.astro', config: 'PRINT_WORKSPACE_ROUTES.batchSpools' },
    { path: '../pages/filaments/[id]/print.astro', config: 'PRINT_WORKSPACE_ROUTES.singleFilament' },
    { path: '../pages/filaments/print.astro', config: 'PRINT_WORKSPACE_ROUTES.batchFilaments' },
  ])('$path delegates to its tested shared workspace configuration', ({ path, config }) => {
    const source = readFileSync(
      fileURLToPath(new URL(path, import.meta.url)),
      'utf8',
    )

    expect(source).toContain('createPrintWorkspaceCoordinator({')
    expect(source).toContain(`config: ${config}`)
  })

  it('mounts the v2 designer sidebar in the shared print shell', () => {
    const shellPath = '../components/LabelPrintPageShell.astro'
    const source = readFileSync(
      fileURLToPath(new URL(shellPath, import.meta.url)),
      'utf8',
    )

    expect(source).toContain("import DesignerSidebar from './freeform-label/DesignerSidebar.astro'")
    expect(source).toContain('<DesignerSidebar />')
    expect(source).not.toContain('<LabelDesignerEditor')
  })

  it('renders Standard, Designer, and Label Sheets as accessible tabs', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(PrintSidebar, {
      props: { backLabel: 'Back' },
    })

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-workspace-mode]'))
    expect(tabs.map(tab => tab.dataset.workspaceMode)).toEqual(['standard', 'designer', 'sheets'])
    expect(document.querySelector('[role="tablist"]')).not.toBeNull()
  })

  it('renders an explicit Standard or Designed Label source selector in sheets mode', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(LabelSheetOutputSettings)

    expect(document.querySelector('#tab-panel-sheets')).not.toBeNull()
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('[name="label-sheet-source"]')).map(input => input.value)).toEqual(['standard', 'designer'])
    expect(document.querySelector<HTMLSelectElement>('#output-mode')?.hidden).toBe(true)
  })

  it('persists the selected sheet label source and designed preset', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(LabelSheetOutputSettings)
    const changed: string[] = []
    const controls = bindLabelSheetControls(() => changed.push('changed'))
    const designer = document.querySelector<HTMLInputElement>('[name="label-sheet-source"][value="designer"]')!
    const preset = document.querySelector<HTMLSelectElement>('#sheet-designer-preset')!
    const option = document.createElement('option')
    option.textContent = 'Compact'
    option.value = 'Compact'
    preset.append(option)

    designer.click()
    preset.value = 'Compact'
    preset.dispatchEvent(new Event('change', { bubbles: true }))

    expect(controls.getSource()).toEqual({ type: 'designer', presetName: 'Compact' })
    expect(preset.disabled).toBe(false)
    expect(JSON.parse(localStorage.getItem('filaman-label-sheet-source-v1')!)).toEqual({ type: 'designer', presetName: 'Compact' })
    expect(changed.length).toBeGreaterThan(0)
  })
})
