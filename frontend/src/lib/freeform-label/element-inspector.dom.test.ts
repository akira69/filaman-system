// @vitest-environment happy-dom

import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { describe, expect, it } from 'vitest'

import ElementInspector from '../../components/freeform-label/ElementInspector.astro'

describe('QR center logo picker', () => {
  it('pairs each keyboard-accessible choice with a labeled visual preview', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(ElementInspector)
    const picker = document.querySelector('[data-element-section="qr"]')!
    const choices = [...picker.querySelectorAll<HTMLInputElement>('input[type="radio"]')]

    expect(choices.map(choice => [choice.name, choice.value, choice.labels?.[0]?.querySelector('[data-i18n]')?.textContent?.trim()])).toEqual([
      ['freeform-qr-center', 'colorLogo', 'Color'],
      ['freeform-qr-center', 'logo', 'Text'],
      ['freeform-qr-center', 'simple', 'None'],
    ])
    for (const choice of choices) {
      expect(choice.disabled).toBe(false)
      expect(choice.tabIndex).toBe(0)
      expect(choice.dataset.elementProp).toBe('mode')
      expect(choice.labels?.[0]?.querySelector('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(choices[0].labels?.[0]?.querySelector('img')?.getAttribute('src')).toBe('/logo-qr.png')
    expect(choices[1].labels?.[0]?.querySelector('svg text')?.textContent).toBe('FilaMan')
    expect(choices[2].labels?.[0]?.querySelector('svg')).not.toBeNull()
    expect(choices[2].labels?.[0]?.querySelector('svg text')).toBeNull()
  })
})

describe('image library actions', () => {
  it('exposes upload as a keyboard-accessible button beside the hidden file picker', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(ElementInspector)
    const upload = document.querySelector<HTMLButtonElement>('#freeform-image-upload-trigger')
    const filePicker = document.querySelector<HTMLInputElement>('#freeform-image-upload')

    expect(upload).toBeInstanceOf(HTMLButtonElement)
    expect(upload?.type).toBe('button')
    expect(upload?.tabIndex).toBe(0)
    expect(upload?.textContent?.trim()).toBe('Upload image')
    expect(upload?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(filePicker?.hidden).toBe(true)
    expect(filePicker?.accept).toBe('image/png,image/jpeg,image/webp')
  })

  it('associates the library deletion control with an explanation separate from element deletion', async () => {
    const container = await AstroContainer.create()
    document.body.innerHTML = await container.renderToString(ElementInspector)
    const deletion = document.querySelector<HTMLButtonElement>('#freeform-image-delete')!
    const description = document.getElementById(deletion.getAttribute('aria-describedby') ?? '')

    expect(deletion.textContent?.trim()).toBe('Delete from library')
    expect(deletion.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(description?.textContent).toContain('saved presets')
    expect(description?.textContent).toContain('Delete in the top toolbar')
    expect(deletion.title).toBe(description?.textContent?.trim())
  })
})
