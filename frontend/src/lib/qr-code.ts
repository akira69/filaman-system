/* eslint-disable @typescript-eslint/no-explicit-any */

const QR_SCRIPT_SELECTOR = 'script[data-filaman-qrcode]'

let qrCodeLoadPromise: Promise<void> | null = null

export function getQrCodeConstructor() {
  return (window as any).QRCode
}

export async function ensureQrCodeLoaded() {
  if (getQrCodeConstructor()) return
  if (qrCodeLoadPromise) return qrCodeLoadPromise

  qrCodeLoadPromise = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(QR_SCRIPT_SELECTOR)

    if (script && script.dataset.filamanQrcodeState !== 'loading') {
      script.remove()
      script = null
    }

    if (!script) {
      script = document.createElement('script')
      script.src = '/vendor/qrcode.min.js'
      script.dataset.filamanQrcode = 'true'
      script.dataset.filamanQrcodeState = 'loading'
      document.head.appendChild(script)
    }

    const cleanup = () => {
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
    const onLoad = () => {
      cleanup()
      if (!script) return
      script.dataset.filamanQrcodeState = 'ready'
      if (getQrCodeConstructor()) {
        resolve()
      } else {
        script.remove()
        reject(new Error('QRCode script loaded without exposing QRCode'))
      }
    }
    const onError = () => {
      cleanup()
      script?.remove()
      reject(new Error('Failed to load QRCode'))
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
  }).finally(() => {
    qrCodeLoadPromise = null
  })

  return qrCodeLoadPromise
}

export function canvasToQrImage(canvas: HTMLCanvasElement, preferCrisp = false) {
  const img = document.createElement('img')
  img.src = canvas.toDataURL('image/png')
  img.style.width = '100%'
  img.style.height = '100%'
  img.style.display = 'block'
  img.style.imageRendering = preferCrisp ? 'pixelated' : 'auto'
  return img
}
