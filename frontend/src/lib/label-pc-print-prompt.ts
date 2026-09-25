import { t } from './i18n'

/* Scale requests stay in the database so every backend worker can see them. */
export function setupPcPrintPrompt() {
  let checking = false
  const banner = document.createElement('div')
  banner.setAttribute('role', 'status')
  banner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:1000;padding:16px;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--accent,#888);border-radius:12px;box-shadow:0 8px 28px #0003;display:flex;align-items:center;gap:12px'
  const message = document.createElement('span')
  const openButton = document.createElement('button')
  openButton.className = 'fm-btn fm-btn-primary'
  openButton.textContent = t('labelPrint.openPcPrint')
  banner.append(message, openButton)

  async function check() {
    if (checking || document.hidden) return
    checking = true
    try {
      const response = await fetch('/api/v1/labels/print-requests/pending', { credentials: 'include' })
      if (!response.ok) return
      const pending: { id: number; spool_id: number; preset_id: number | null } | null = await response.json()
      if (!pending) {
        banner.remove()
        return
      }
      message.textContent = t('labelPrint.pcPrintPrompt', { id: pending.spool_id })
      openButton.onclick = () => {
        const printWindow = window.open('about:blank', '_blank')
        if (!printWindow) return
        const csrf = document.cookie.split('; ').find(row => row.startsWith('csrf_token='))?.split('=')[1] || ''
        void fetch(`/api/v1/labels/print-requests/${pending.id}/claim`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': decodeURIComponent(csrf) },
          credentials: 'include',
        }).then(response => {
          if (!response.ok) throw new Error('Print request was already claimed')
          const preset = pending.preset_id ? `&preset_id=${pending.preset_id}` : ''
          printWindow.location.href = `/spools/${pending.spool_id}/print?scale_print=1${preset}`
        }).catch(() => printWindow.close()).finally(() => banner.remove())
      }
      if (!banner.isConnected) document.body.appendChild(banner)
    } catch { /* Keep the tab usable when the server is unavailable. */ }
    finally { checking = false }
  }

  void check()
  const timer = window.setInterval(() => { void check() }, 3000)
  window.addEventListener('pagehide', event => {
    if (!event.persisted) window.clearInterval(timer)
  })
}
