// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { initHeaderColumnFilters } from './table-column-filters'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('color range header filter', () => {
  it('keeps the normal color filter usable beside the range gear', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    const onNamesApply = vi.fn()
    const controller = initHeaderColumnFilters(document.querySelector('table')!, [
      {
        key: 'colors', label: 'Colors', columnSelector: 'th.col-colors', type: 'multi',
        multiDisplay: 'colors', options: [], onApply: onNamesApply,
      },
      {
        key: 'colorRange', label: 'Color range', columnSelector: 'th.col-colors', type: 'color',
        icon: 'gear', onApply: vi.fn(),
      },
    ])
    controller.setOptions('colors', [{ value: 'Red', label: 'Red', colorHexes: ['#FF0000'] }])

    const triggers = document.querySelectorAll<HTMLButtonElement>('.fm-header-filter-trigger')
    expect(triggers).toHaveLength(2)
    triggers[0].click()
    const red = document.querySelector<HTMLInputElement>('.fm-header-filter-panel.open [data-value="Red"]')!
    red.click()
    document.querySelector<HTMLButtonElement>('.fm-header-filter-panel.open .fm-btn-primary')!.click()
    expect(onNamesApply).toHaveBeenCalledWith({ type: 'multi', values: ['Red'] })

    triggers[1].click()
    expect(document.querySelector('.fm-header-filter-panel.open .fm-header-color-title')?.textContent).toBe('COLOR FILTER')
    expect(controller.getValue('colors')).toEqual({ type: 'multi', values: ['Red'] })
  })

  it('uses top color modes and mutes chromatic controls for a neutral mode', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    const onApply = vi.fn()
    initHeaderColumnFilters(document.querySelector('table')!, [{
      key: 'colorRange',
      label: 'Colors',
      columnSelector: 'th.col-colors',
      type: 'color',
      icon: 'gear',
      onApply,
    }])

    document.querySelector<HTMLButtonElement>('.fm-header-filter-trigger')!.click()
    const hueFrom = document.querySelector<HTMLInputElement>('[data-color-field="hueFrom"]')!
    const hueTo = document.querySelector<HTMLInputElement>('[data-color-field="hueTo"]')!
    const saturationFrom = document.querySelector<HTMLInputElement>('[data-color-field="saturationFrom"]')!
    const valueTo = document.querySelector<HTMLInputElement>('[data-color-field="valueTo"]')!
    const valuePreview = document.querySelector<HTMLInputElement>('[data-color-field="valuePreview"]')!
    const transparent = document.querySelector<HTMLInputElement>('[data-color-transparent]')!
    const color = document.querySelector<HTMLButtonElement>('[data-color-mode="color"]')!
    const black = document.querySelector<HTMLButtonElement>('[data-color-neutral="black"]')!
    const white = document.querySelector<HTMLButtonElement>('[data-color-neutral="white"]')!
    const grey = document.querySelector<HTMLButtonElement>('[data-color-neutral="grey"]')!
    expect(hueFrom.type).toBe('range')
    expect(hueFrom.parentElement).toBe(hueTo.parentElement)
    expect(hueFrom.parentElement?.classList.contains('fm-header-color-dual-range')).toBe(true)
    expect([hueFrom.min, hueFrom.max, hueTo.min, hueTo.max]).toEqual(['0', '360', '0', '360'])
    expect(saturationFrom.type).toBe('range')
    expect(valueTo.type).toBe('range')
    expect(valuePreview.type).toBe('range')
    expect(valuePreview.parentElement).toBe(valueTo.parentElement)
    expect(valuePreview.classList.contains('fm-header-color-preview-range')).toBe(true)
    expect(document.querySelector('.fm-header-color-title')?.textContent).toBe('COLOR FILTER')
    expect(color.querySelector('.fm-header-color-wheel-icon')).not.toBeNull()
    expect(color.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('[data-color-chromatic]')).toBeNull()
    expect([black.type, white.type, grey.type]).toEqual(['button', 'button', 'button'])
    expect(transparent.type).toBe('checkbox')
    expect(transparent.parentElement?.textContent).toContain('Include transparent hex')
    expect(document.querySelector('.fm-header-color-wheel')).not.toBeNull()

    color.click()
    expect(color.getAttribute('aria-pressed')).toBe('true')
    expect([...document.querySelectorAll<HTMLInputElement>('[data-color-field]')].every((input) => !input.disabled)).toBe(true)

    black.click()
    expect(black.getAttribute('aria-pressed')).toBe('true')
    expect(color.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector<HTMLElement>('.fm-header-color-wheel-selection')!.hidden).toBe(true)
    expect([...document.querySelectorAll<HTMLInputElement>('[data-color-field]')].every((input) => input.disabled)).toBe(true)
    expect([...document.querySelectorAll('.fm-header-color-range')].every((range) => range.classList.contains('is-muted'))).toBe(true)
    white.click()
    expect(black.getAttribute('aria-pressed')).toBe('false')
    expect(white.getAttribute('aria-pressed')).toBe('true')
    white.click()
    expect(white.getAttribute('aria-pressed')).toBe('false')
    expect(color.getAttribute('aria-pressed')).toBe('true')
    grey.click()
    expect(grey.getAttribute('aria-pressed')).toBe('true')
    color.click()
    expect(grey.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector<HTMLElement>('.fm-header-color-wheel-selection')!.hidden).toBe(false)
    expect([...document.querySelectorAll<HTMLInputElement>('[data-color-field]')].every((input) => !input.disabled)).toBe(true)

    hueFrom.value = '330'
    hueFrom.dispatchEvent(new Event('input', { bubbles: true }))
    expect(hueFrom.value).toBe('45')
    expect(grey.getAttribute('aria-pressed')).toBe('false')
    hueFrom.value = '30'
    hueFrom.dispatchEvent(new Event('input', { bubbles: true }))
    hueTo.value = '20'
    hueTo.dispatchEvent(new Event('input', { bubbles: true }))
    expect(hueTo.value).toBe('30')
    hueTo.value = '45'
    hueTo.dispatchEvent(new Event('input', { bubbles: true }))
    expect([hueFrom.min, hueFrom.max, hueTo.min, hueTo.max]).toEqual(['0', '360', '0', '360'])
    const wheel = document.querySelector<HTMLElement>('.fm-header-color-wheel')!
    expect(wheel.style.getPropertyValue('--color-hue-from')).toBe('45deg')
    expect(wheel.style.getPropertyValue('--color-hue-span')).toBe('15deg')
    saturationFrom.value = '40'
    saturationFrom.dispatchEvent(new Event('input', { bubbles: true }))
    valueTo.value = '75'
    valueTo.dispatchEvent(new Event('input', { bubbles: true }))
    expect(valuePreview.value).toBe('75')
    valuePreview.value = '60'
    valuePreview.dispatchEvent(new Event('input', { bubbles: true }))
    expect(wheel.style.getPropertyValue('--color-wheel-darkness')).toBe('0.4')
    transparent.click()
    document.querySelector<HTMLButtonElement>('.fm-header-filter-actions .fm-btn-primary')!.click()

    expect(onApply).toHaveBeenCalledWith({
      type: 'color',
      chromatic: true,
      hueFrom: 30,
      hueTo: 45,
      saturationFrom: 40,
      saturationTo: 100,
      valueFrom: 0,
      valueTo: 75,
      valuePreview: 60,
      includeTransparent: true,
      neutrals: [],
    })
  })

  it('clears every color mode and mutes the inactive controls', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    const onApply = vi.fn()
    initHeaderColumnFilters(document.querySelector('table')!, [{
      key: 'colorRange', label: 'Colors', columnSelector: 'th.col-colors', type: 'color', icon: 'gear', onApply,
    }])

    document.querySelector<HTMLButtonElement>('.fm-header-filter-trigger')!.click()
    document.querySelector<HTMLInputElement>('[data-color-transparent]')!.click()
    document.querySelector<HTMLButtonElement>('.fm-header-filter-actions .fm-btn-outline')!.click()

    expect([...document.querySelectorAll<HTMLButtonElement>('[data-color-mode], [data-color-neutral]')]
      .every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect([...document.querySelectorAll<HTMLInputElement>('[data-color-field]')].every((input) => input.disabled)).toBe(true)
    expect([...document.querySelectorAll('.fm-header-color-range')].every((range) => range.classList.contains('is-muted'))).toBe(true)
    expect(document.querySelector<HTMLElement>('.fm-header-color-wheel-selection')!.hidden).toBe(true)
    expect(document.querySelector<HTMLInputElement>('[data-color-transparent]')!.checked).toBe(false)
    expect(document.querySelector('.fm-header-color-transparent')?.classList.contains('is-muted')).toBe(true)
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({
      chromatic: false,
      includeTransparent: false,
      neutrals: [],
    }))
  })

  it('moves the complete hue arc from the wheel and its middle grab handle', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    initHeaderColumnFilters(document.querySelector('table')!, [{
      key: 'colorRange', label: 'Colors', columnSelector: 'th.col-colors', type: 'color', icon: 'gear', onApply: vi.fn(),
    }])
    document.querySelector<HTMLButtonElement>('.fm-header-filter-trigger')!.click()
    const wheel = document.querySelector<HTMLElement>('.fm-header-color-wheel')!
    const hueFrom = document.querySelector<HTMLInputElement>('[data-color-field="hueFrom"]')!
    const hueTo = document.querySelector<HTMLInputElement>('[data-color-field="hueTo"]')!
    const grab = document.querySelector<HTMLElement>('[data-color-grab="hue"]')!
    const slider = grab.parentElement!
    document.querySelector<HTMLButtonElement>('[data-color-mode="color"]')!.click()
    expect(grab.getAttribute('role')).toBe('slider')
    expect(grab.style.left).toBe('calc(7.6389% + 7.2014px)')
    vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 180, height: 180 } as DOMRect)
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 360, height: 20 } as DOMRect)

    wheel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 90, pointerId: 1 }))
    expect([hueFrom.value, hueTo.value]).toEqual(['163', '198'])
    wheel.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 90, clientY: 180, pointerId: 1 }))
    wheel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    expect([hueFrom.value, hueTo.value]).toEqual(['253', '288'])

    grab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 270, pointerId: 2 }))
    grab.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 290, pointerId: 2 }))
    grab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }))
    expect([hueFrom.value, hueTo.value]).toEqual(['274', '309'])
    grab.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    expect([hueFrom.value, hueTo.value]).toEqual(['275', '310'])
    grab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 270, pointerId: 4 }))
    grab.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -1102, pointerId: 4 }))
    grab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4 }))
    expect([hueFrom.value, hueTo.value]).toEqual(['275', '310'])

    wheel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 180, clientY: 90, pointerId: 3 }))
    wheel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }))
    expect([hueFrom.value, hueTo.value]).toEqual(['343', '18'])
    expect(grab.hidden).toBe(true)
    hueFrom.value = '350'
    hueFrom.dispatchEvent(new Event('input', { bubbles: true }))
    hueTo.value = '25'
    hueTo.dispatchEvent(new Event('input', { bubbles: true }))
    expect([hueFrom.value, hueTo.value]).toEqual(['350', '25'])
  })

  it('keeps a full hue circle intact when its midpoint control moves', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    initHeaderColumnFilters(document.querySelector('table')!, [{
      key: 'colorRange',
      label: 'Colors',
      columnSelector: 'th.col-colors',
      type: 'color',
      icon: 'gear',
      initialValue: {
        type: 'color', chromatic: true, hueFrom: 0, hueTo: 360,
        saturationFrom: 0, saturationTo: 100, valueFrom: 0, valueTo: 100,
        valuePreview: 100, includeTransparent: false, neutrals: [],
      },
      onApply: vi.fn(),
    }])
    document.querySelector<HTMLButtonElement>('.fm-header-filter-trigger')!.click()
    const grab = document.querySelector<HTMLElement>('[data-color-grab="hue"]')!
    vi.spyOn(grab.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 360, height: 20 } as DOMRect)
    grab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 180, pointerId: 1 }))
    grab.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 200, pointerId: 1 }))
    expect([
      document.querySelector<HTMLInputElement>('[data-color-field="hueFrom"]')!.value,
      document.querySelector<HTMLInputElement>('[data-color-field="hueTo"]')!.value,
    ]).toEqual(['0', '360'])
  })

  it('applies one soft neutral without the chromatic slice', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    const onApply = vi.fn()
    initHeaderColumnFilters(document.querySelector('table')!, [{
      key: 'colorRange',
      label: 'Colors',
      columnSelector: 'th.col-colors',
      type: 'color',
      icon: 'gear',
      onApply,
    }])

    document.querySelector<HTMLButtonElement>('.fm-header-filter-trigger')!.click()
    document.querySelector<HTMLButtonElement>('[data-color-neutral="black"]')!.click()
    document.querySelector<HTMLButtonElement>('.fm-header-filter-actions .fm-btn-primary')!.click()

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      type: 'color',
      chromatic: false,
      neutrals: ['black'],
    }))
  })

  it('normalizes restored checkbox selections to one neutral button', () => {
    document.body.innerHTML = '<table><thead><tr><th class="col-colors">Colors</th></tr></thead></table>'
    const onApply = vi.fn()
    initHeaderColumnFilters(document.querySelector('table')!, [{
      key: 'colorRange',
      label: 'Colors',
      columnSelector: 'th.col-colors',
      type: 'color',
      icon: 'gear',
      initialValue: {
        type: 'color',
        chromatic: true,
        hueFrom: 10,
        hueTo: 45,
        saturationFrom: 20,
        saturationTo: 100,
        valueFrom: 0,
        valueTo: 100,
        valuePreview: 100,
        includeTransparent: false,
        neutrals: ['black', 'white'],
      },
      onApply,
    }])

    document.querySelector<HTMLButtonElement>('.fm-header-filter-trigger')!.click()
    const black = document.querySelector<HTMLButtonElement>('[data-color-neutral="black"]')!
    expect(black.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-color-neutral="white"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(document.activeElement).toBe(black)
    document.querySelector<HTMLButtonElement>('.fm-header-filter-actions .fm-btn-primary')!.click()
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ chromatic: false, neutrals: ['black'] }))
  })
})
