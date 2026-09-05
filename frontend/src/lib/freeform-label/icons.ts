export type DesignerIconName =
  | 'text'
  | 'qr'
  | 'logo'
  | 'image'
  | 'swatch'
  | 'shape'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'forward'
  | 'back'
  | 'uppercase'
  | 'inverse'
  | 'colorInverse'
  | 'date'

const paths: Record<DesignerIconName, string> = {
  text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2v6h-6v-2"/>',
  logo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m6 16 4-4 3 3 2-2 3 3"/><circle cx="8" cy="9" r="1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
  swatch: '<path d="M5 4h14v16H5z"/><path d="M5 15h14M10 4v11M15 4v11"/>',
  shape: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  undo: '<path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  forward: '<path d="M7 17 17 7M10 7h7v7"/>',
  back: '<path d="m17 7-10 10M7 10v7h7"/>',
  uppercase: '<path d="M4 18 9 6l5 12M6 14h6M15 9h5M17.5 6v6"/>',
  inverse: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  colorInverse: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/><path d="M8 8h8v8H8z"/>',
  date: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h1M8 17h2M12 17h2"/>',
}

export function designerIcon(name: DesignerIconName) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`
}
