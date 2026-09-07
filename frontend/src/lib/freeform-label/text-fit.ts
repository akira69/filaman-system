/** Measure attached clones so the same fitting works for previews and detached export roots. */
export async function fitLabelText(nodes: HTMLElement[]): Promise<void> {
  if (nodes.length === 0) return
  const measurement = document.createElement('div')
  measurement.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
  const clones = nodes.map(node => node.cloneNode(true) as HTMLElement)
  measurement.append(...clones)
  document.body.appendChild(measurement)
  try {
    // Trigger layout/font discovery before waiting for the fonts used by the clones.
    for (const clone of clones) void clone.offsetWidth
    if (document.fonts) await document.fonts.ready
    clones.forEach((clone, index) => {
      const width = clone.clientWidth
      if (width <= 0 || clone.scrollWidth <= width) return
      let low = 0.265 // Legacy fitting permits approximately one CSS pixel.
      let high = Number.parseFloat(clone.style.fontSize)
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const middle = (low + high) / 2
        clone.style.fontSize = `${middle}mm`
        if (clone.scrollWidth <= width) low = middle
        else high = middle
      }
      nodes[index].style.fontSize = `${low}mm`
    })
  } finally {
    measurement.remove()
  }
}
