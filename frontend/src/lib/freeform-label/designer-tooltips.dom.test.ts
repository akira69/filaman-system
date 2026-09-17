// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import CanvasTextToolbar from '../../components/freeform-label/CanvasTextToolbar.astro'
import ElementInspector from '../../components/freeform-label/ElementInspector.astro'
import { bindDesignerTooltips } from './designer-tooltips'
import { designerIcon } from './icons'

describe('designer tooltips', () => {
  it('shows a prompt tooltip for titled, labeled, and QR choice controls without a duplicate native title', () => {
    document.body.innerHTML = `<div id="workspace"><button title="Add text">Text</button><button aria-label="Scale font to fit"></button><label class="freeform-qr-center-option" title="No center logo"><input type="radio" />None</label></div>`
    const workspace = document.querySelector<HTMLElement>('#workspace')!
    const [add, fit] = Array.from(workspace.querySelectorAll('button'))
    const choice = workspace.querySelector<HTMLElement>('label')!
    const unbind = bindDesignerTooltips(workspace)

    add.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Add text')
    expect(add.hasAttribute('title')).toBe(false)

    fit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Scale font to fit')
    expect(add.title).toBe('Add text')

    choice.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('No center logo')
    unbind()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(choice.title).toBe('No center logo')
  })

  it('lets the fit icon follow its button color in both toggle states', () => {
    document.body.innerHTML = `<button style="color: white">${designerIcon('fitText')}</button>`
    const svg = document.querySelector('svg')!
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect([...svg.querySelectorAll('path')].every(path => !path.hasAttribute('stroke'))).toBe(true)
    expect(svg.innerHTML).toContain('M8 8h8')
  })

  it('keeps Min beside Fit before Wrap and explains the text actions accurately', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = `<div id="workspace">${await container.renderToString(CanvasTextToolbar)}</div>`
    const workspace = document.querySelector<HTMLElement>('#workspace')!
    const edit = workspace.querySelector<HTMLButtonElement>('[data-text-select]')!
    const fit = workspace.querySelector<HTMLButtonElement>('[data-element-toggle="fitToWidth"]')!
    const wrap = workspace.querySelector<HTMLButtonElement>('[data-element-toggle="wrap"]')!
    const min = workspace.querySelector<HTMLElement>('#freeform-fit-settings')!
    const pair = workspace.querySelector<HTMLElement>('.freeform-fit-pair')!
    expect(pair.children[0]).toBe(min)
    expect(pair.children[1]).toBe(fit)
    expect(pair.nextElementSibling).toBe(wrap)

    const unbind = bindDesignerTooltips(workspace)
    edit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Click to edit text directly on the label. Press Escape to return to moving the element.')
    fit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Shrink all text in this element to fit its box.')
    expect(fit.getAttribute('aria-label')).toBe('Scale font to fit')
    wrap.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Wrap this text element within its width; Wrap alone doesn't shrink the font. With Scale font to fit, use at most two lines.")
    unbind()
  })

  it('does not repeat the visible ELEMENT JSON label in a tooltip', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = `<div id="workspace">${await container.renderToString(ElementInspector)}</div>`
    const workspace = document.querySelector<HTMLElement>('#workspace')!
    const trigger = document.querySelector<HTMLElement>('#freeform-json-expand')!
    const unbind = bindDesignerTooltips(workspace)

    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.hidden).toBe(true)
    unbind()
  })

  it('explains font weight and size when their labels are hovered', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = `<div id="workspace">${await container.renderToString(CanvasTextToolbar)}</div>`
    const workspace = document.querySelector<HTMLElement>('#workspace')!
    const weight = document.querySelector<HTMLElement>('[data-element-prop="fontWeight"]')!.closest('label')!
    const size = document.querySelector<HTMLElement>('[data-element-prop="fontSizeMm"]')!.closest('label')!
    const unbind = bindDesignerTooltips(workspace)

    weight.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.textContent).toContain('whole text element')
    size.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.textContent).toContain('millimeters')
    unbind()
  })
})
