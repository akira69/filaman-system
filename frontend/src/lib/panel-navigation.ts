/** Mount the page script once for each instance of its main panel. */
export function mountPanel(name: string, setup: (signal: AbortSignal) => void | Promise<void>): void {
  let mounted: HTMLElement | null = null

  function mount() {
    const panel = document.querySelector<HTMLElement>('main[data-panel]')
    if (panel?.dataset.panel !== name || panel === mounted) return
    mounted = panel
    const controller = new AbortController()
    const signal = controller.signal
    document.addEventListener('astro:before-swap', () => {
      controller.abort()
      mounted = null
    }, { once: true })
    void Promise.resolve().then(() => {
      if (!signal.aborted) return setup(signal)
    }).catch(error => {
      if (!signal.aborted) console.error('Could not initialize panel:', error)
    })
  }

  document.addEventListener('astro:page-load', mount)
  mount()
}
