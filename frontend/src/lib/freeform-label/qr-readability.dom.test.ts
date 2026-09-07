// @vitest-environment happy-dom

import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { describe, expect, it } from 'vitest'

import ElementInspector from '../../components/freeform-label/ElementInspector.astro'
import { bindFreeformEditorDom } from './editor-dom'
import { createFreeformEditorController } from './editor-state'
import type { LabelDesignV2 } from './types'

const design: LabelDesignV2 = {
  version: 2,
  label: { widthMm: 60, heightMm: 40, marginMm: 1, border: false },
  elements: [{
    id: 'qr', type: 'qr', x: 2, y: 2, w: 13, h: 13, z: 0,
    mode: 'simple', linkMode: 'spool', urlTemplate: '',
  }],
}

async function renderEditor(moduleCounts: number[]) {
  const container = await AstroContainer.create()
  document.body.innerHTML = `${await container.renderToString(ElementInspector)}<div id="freeform-canvas-host"></div>`
  const host = document.querySelector<HTMLElement>('#freeform-canvas-host')!
  const controller = createFreeformEditorController({
    initialDesign: design,
    render: renderedDesign => {
      const preview = document.createElement('div')
      preview.className = 'label-preview'
      for (const moduleCount of moduleCounts) {
        const qr = document.createElement('div')
        qr.dataset.labelElementId = renderedDesign.elements[0].id
        qr.dataset.labelElementType = 'qr'
        qr.dataset.qrModuleCount = String(moduleCount)
        preview.append(qr)
      }
      host.replaceChildren(preview)
    },
  })
  const binding = bindFreeformEditorDom({ root: document, controller, editable: false })
  await binding.ready
  return { binding, controller }
}

describe('QR readability advisory', () => {
  it('uses the densest rendered batch QR and warns without restricting its geometry', async () => {
    const { binding, controller } = await renderEditor([37, 41])
    const recommendation = document.querySelector<HTMLElement>('#freeform-qr-readability-recommendation')!
    const warning = document.querySelector<HTMLElement>('#freeform-qr-readability-warning')!

    expect(recommendation.textContent).toContain('13.89 mm')
    expect(warning.hidden).toBe(false)
    expect(warning.textContent).toContain('13.89 mm')
    expect(controller.getSelectedElement()).toMatchObject({ w: 13, h: 13 })

    controller.updateSelected({ w: 13.89 })
    binding.sync()

    expect(warning.hidden).toBe(true)
    expect(controller.getSelectedElement()).toMatchObject({ w: 13.89, h: 13.89 })
    binding.destroy()
  })

  it('keeps quiet-zone and test-print advice when module metadata is unavailable', async () => {
    const { binding } = await renderEditor([])
    const recommendation = document.querySelector<HTMLElement>('#freeform-qr-readability-recommendation')!
    const warning = document.querySelector<HTMLElement>('#freeform-qr-readability-warning')!
    const note = document.querySelector<HTMLElement>('#freeform-qr-readability-note')!

    expect(recommendation.textContent).toContain('after the code is rendered')
    expect(warning.hidden).toBe(true)
    expect(note.textContent).toContain('4 modules')
    expect(note.textContent).toContain('test print')
    binding.destroy()
  })
})
