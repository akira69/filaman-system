import { renderLabel as render } from '../../src/lib/label-svg/core.mjs';
export * from '../../src/lib/label-svg/core.mjs';
export { createSvgRuntime } from '../../src/lib/label-svg/runtime.mjs';

// Preserve the lab's deterministic origin; application callers supply their own.
export const renderLabel = (preset, data, assets, fonts, dpi, baseUrl = 'https://fila.test', options = {}) =>
  render(preset, data, assets, fonts, dpi, baseUrl, options);
