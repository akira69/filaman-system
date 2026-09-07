/** Drawer visibility is selection-local; canvas clearance lasts for the editor session. */
export function bindFieldDrawer(root: ParentNode) {
  const dock = root.querySelector<HTMLElement>('#freeform-field-dock')
  const toggle = root.querySelector<HTMLButtonElement>('#freeform-field-dock-toggle')
  const body = root.querySelector<HTMLElement>('#freeform-field-dock-body')
  const content = root.querySelector<HTMLElement>('.freeform-field-dock-content')
  const stage = root.querySelector<HTMLElement>('.freeform-canvas-stage')
  const area = root.querySelector<HTMLElement>('.freeform-canvas-area')
  let selectedTextId: string | undefined
  let editable = false
  let collapsed = false
  let clearance = 0

  const reserveSpace = () => {
    if (!editable || !selectedTextId || collapsed || !content || !stage) return
    // Extra bottom scroll space also lets enlarged artwork be scrolled clear of
    // the overlay. Never remove it on close: that would recenter the artwork.
    const limit = dock ? parseFloat(getComputedStyle(dock).getPropertyValue('--freeform-drawer-body-limit')) : NaN
    const available = area?.clientHeight ? Math.max(0, area.clientHeight - (toggle?.offsetHeight ?? 0)) : Infinity
    const next = Math.max(clearance, Math.min(content.offsetHeight, Number.isFinite(limit) ? limit : Infinity, available))
    if (next === clearance) return
    clearance = next
    stage.style.setProperty('--freeform-drawer-clearance', `${clearance}px`)
  }
  const sync = () => {
    if (!dock || !toggle || !body) return
    const available = editable && Boolean(selectedTextId)
    const open = available && !collapsed
    dock.dataset.open = String(open)
    dock.dataset.available = String(available)
    toggle.disabled = !available
    toggle.setAttribute('aria-expanded', String(open))
    if (!open && body.contains(body.ownerDocument.activeElement)) toggle.focus({ preventScroll: true })
    body.toggleAttribute('inert', !open)
    body.setAttribute('aria-hidden', String(!open))
    reserveSpace()
  }
  const onToggle = () => { collapsed = !collapsed; sync() }
  toggle?.addEventListener('click', onToggle)
  const observer = content && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reserveSpace) : null
  if (content) observer?.observe(content)
  if (area) observer?.observe(area)

  return {
    update(textId: string | undefined, canEdit: boolean) {
      if (textId !== selectedTextId) collapsed = false
      selectedTextId = textId
      editable = canEdit
      sync()
    },
    destroy() {
      observer?.disconnect()
      toggle?.removeEventListener('click', onToggle)
      stage?.style.removeProperty('--freeform-drawer-clearance')
    },
  }
}
