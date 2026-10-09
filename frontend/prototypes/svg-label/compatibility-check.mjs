// Expanded font/shape compatibility matrix for the shared renderer.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const directory = process.env.LABEL_EVIDENCE_DIR;
if (!directory) throw new Error('Set LABEL_EVIDENCE_DIR to an ignored artifact directory');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.goto('http://127.0.0.1:4407/prototypes/svg-label/');
  await page.waitForFunction(() => window.probeResult);
  const results = await page.evaluate(async () => {
    const { renderLabel, rasterize, loadFonts } = await import('/prototypes/svg-label/render.mjs');
    const { LABEL_FONT_FAMILIES, LABEL_FONT_WEIGHTS, LABEL_SHAPES } = await import('/src/lib/freeform-label/types.ts');
    const { renderDesignerLabel } = await import('/src/lib/label-designer.ts');
    const { waitForLabelOutputAssets } = await import('/src/lib/label-output-readiness.ts');
    const model = await fetch('/probe/fixtures').then(r => r.json());
    const fonts = await loadFonts(async (_file, index) => new Uint8Array(await fetch(`/probe/font/${index}`).then(r => r.arrayBuffer())));
    const phrase = 'Ä Ö Ü ä ö ü ß — Grüße, größere Füße, süß';
    const text = (extra = {}) => ({ id: 'text', type: 'text', x: 1, y: 1, w: 38, h: 28,
      template: phrase, fontFamily: 'Space Grotesk', fontWeight: 400, fontSizeMm: 3,
      wrap: true, fitToWidth: true, minFontSizeMm: 1, color: '#000000', ...extra });
    const preset = elements => ({ version: 2, design: { version: 2,
      label: { widthMm: 40, heightMm: 30, marginMm: 1, border: false }, elements } });
    const cases = [];
    for (const fontFamily of LABEL_FONT_FAMILIES) for (const fontWeight of LABEL_FONT_WEIGHTS)
      for (const options of [
        { name: 'wrap', w: 18, h: 28, wrap: true, fitToWidth: false },
        { name: 'wrap + fit', w: 18, h: 9, wrap: true, fitToWidth: true },
        { name: 'no-wrap + fit', w: 38, h: 28, wrap: false, fitToWidth: true },
      ]) cases.push({ name: `${fontFamily} ${fontWeight} ${options.name}`, fontCase: options.name,
        elements: [text({ fontFamily, fontWeight, ...options })] });
    for (const shape of LABEL_SHAPES) cases.push({ name: shape, elements: [{ id: shape,
      type: 'shape', shape, x: 3, y: 3, w: 12, h: shape === 'line' ? 1 : shape === 'rectangle' ? 8 : 12,
      fill: '#eeeeee', stroke: '#000000', strokeWidthMm: 0.5, radiusMm: 0 }] });
    cases.push(
      { name: 'Mixed font families in separate boxes', elements: LABEL_FONT_FAMILIES.map((fontFamily, i) => text({ id: `font-${i}`, fontFamily, y: 1 + i * 7, h: 6, fontSizeMm: 2 })) },
      { name: 'Mixed regular/bold in separate boxes', elements: [text({ y: 1, h: 13 }), text({ id: 'bold', y: 16, h: 13, fontWeight: 700 })] },
      { name: 'Mixed inline fonts', elements: [text({ template: 'Grüße [font=Fraunces]größere Füße[/font]' })] },
      { name: 'Mixed inline bold', elements: [text({ template: 'Grüße **größere Füße**' })] },
      { name: 'Font-tag separator wrap boundary', elements: [text({ w: 5, h: 20, fitToWidth: false, template: 'A[font=Space Mono] B[/font]' })] },
      { name: 'Empty conditional', elements: [text({ w: 5, h: 0.5, fitToWidth: false, template: '[if={missing}]ÄÖÜ[/if]' })] },
      { name: 'Umlauts, wrapped', elements: [text({ w: 18 })] },
      { name: 'Umlauts, shrink to fit', elements: [text({ w: 18, h: 9 })] },
      { name: 'Umlauts, no-wrap shrink to fit', elements: [text({ wrap: false })] },
      { name: 'Explicit blank lines', elements: [text({ template: 'ÄÖÜ\n\näöü ß', wrap: false })] },
      { name: 'Too small at minimum font', elements: [text({ w: 5, h: 1 })] },
      { name: 'All drawing elements together', elements: LABEL_SHAPES.map((shape, i) => ({ id: shape, type: 'shape', shape, x: 1 + i * 9, y: 3, w: 8, h: shape === 'rectangle' ? 5 : 8, fill: '#eeeeee', stroke: '#000000', strokeWidthMm: 0.4, radiusMm: 0 })) },
    );
    const rows = [];
    for (const item of cases) for (const dpi of [203, 300]) for (const threshold of [150, 200]) {
      const input = preset(item.elements);
      let local, raster, error;
      try { local = renderLabel(input, model.data, model.assets, fonts, dpi); raster = rasterize(local.svg, threshold); }
      catch (caught) { error = caught.message; }
      const response = await fetch('/probe/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: input, data: model.data, dpi, threshold }) });
      const remote = await response.json();
      const mono = remote.mono && Uint8Array.from(atob(remote.mono), c => c.charCodeAt(0));
      const pixels = remote.pixels && Uint8Array.from(atob(remote.pixels), c => c.charCodeAt(0));
      rows.push({ name: item.name, fontCase: item.fontCase, dpi, threshold, status: error ? 'unsupported/error' : 'rendered', error,
        same: error ? error === remote.error : response.ok && local.svg === remote.svg && raster.mono.length === mono.length && raster.mono.every((v, i) => v === mono[i]) && raster.pixels.length === pixels.length && raster.pixels.every((v, i) => v === pixels[i]),
        text: local?.text, ink: raster?.mono.some(v => v !== 0) });
    }
    // Current editor baseline: all fonts, umlauts and shapes share one actual V2 label.
    const design = preset(cases.find(c => c.name === 'Mixed font families in separate boxes').elements).design;
    design.label = { ...design.label, widthMm: 60, heightMm: 55 };
    design.elements.forEach(e => { e.w = 58; e.fontSizeMm = 3; e.template = `${e.fontFamily}: ÄÖÜ äöü ß`; });
    design.elements.push(text({ id: 'inline', x: 1, y: 30, w: 58, h: 8, fontSizeMm: 2.8, template: 'Grüße [font=Fraunces]größere[/font] [font=Space Mono]Füße[/font]' }));
    design.elements.push(...cases.find(c => c.name === 'All drawing elements together').elements.map(e => ({ ...e, y: 44 })));
    const target = document.createElement('div');
    target.id = 'compatibility-baseline';
    document.querySelector('main').replaceChildren(target);
    await renderDesignerLabel({ element: target, design, data: model.data, previewBorder: false });
    await waitForLabelOutputAssets([target]);
    await document.fonts.ready;
    target.style.zoom = '3';
    return { rows, baselineErrors: [...target.querySelectorAll('[data-label-output-error]')].map(e => e.dataset.labelOutputError),
      baselineText: target.textContent, fontsLoaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.weight}`) };
  });
  assert.ok(results.rows.every(row => row.same), 'Browser/server outcomes differ');
  for (const row of results.rows) assert.equal(row.status === 'rendered', row.name !== 'Too small at minimum font', row.name);
  assert.ok(results.rows.filter(row => row.status === 'rendered' && row.name !== 'Empty conditional').every(row => row.ink), 'Blank raster');
  for (const row of results.rows.filter(row => row.name === 'Empty conditional')) assert.equal(row.ink, false);
  for (const row of results.rows.filter(row => row.name === 'Font-tag separator wrap boundary')) assert.deepEqual(row.text[0].lines, ['A', 'B']);
  assert.deepEqual(results.baselineErrors, []);
  for (const row of results.rows.filter(row => row.text && (row.fontCase || row.name.startsWith('Umlauts')))) {
    assert.equal(row.text[0].lines.join('').replace(/\s/g, ''), 'Ä Ö Ü ä ö ü ß — Grüße, größere Füße, süß'.replace(/\s/g, ''));
    if (row.name === 'Umlauts, shrink to fit' || row.fontCase?.includes('fit')) assert.ok(row.text[0].size < 3 && row.text[0].size >= 1, row.name);
    if (row.name === 'Umlauts, wrapped' || row.fontCase === 'wrap') assert.ok(row.text[0].lines.length > 1, row.name);
  }
  await writeFile(`${directory}/compatibility-results.json`, JSON.stringify(results, null, 2));
  await page.locator('#compatibility-baseline').screenshot({ path: `${directory}/existing-editor-mixed-fonts-shapes.png` });
  console.log(JSON.stringify({ cases: results.rows.length, rendered: results.rows.filter(r => r.status === 'rendered').length,
    rows: results.rows.filter(r => r.dpi === 203 && r.threshold === 200).map(({ name, status, error }) => ({ name, status, error })), fontsLoaded: results.fontsLoaded }, null, 2));
} finally { await browser.close(); }
