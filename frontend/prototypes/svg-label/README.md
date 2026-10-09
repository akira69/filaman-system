# Shared SVG label spike

Disposable feasibility experiment on `codex/svg-label-prototype`, based on API commit
`7cfbdda`. It does not change production editor/API behavior, preset storage or Docker
image. The existing template-expansion helper is exported for reuse, without changing
its implementation.

## Run

From `frontend`, with the normal Node dependencies installed and the backend environment
available at `backend/.venv`:

```sh
npm run prototype:svg
# Optional, read-only tester exports (presets.json + presets_tiny_qr.json):
LABEL_TESTER_PRESETS_DIR=/path/to/labelapi_2026-10-05 npm run prototype:svg
```

Open <http://127.0.0.1:4407/prototypes/svg-label/>. Change the information-box width,
Wrap text, Scale font to fit, DPI, threshold, output mode or logo presence, then render again. This loopback-only
development server is not a production API; do not expose it publicly.

Checks, from a second terminal in `frontend`:

```sh
npx vitest run prototypes/svg-label/render.test.ts
LABEL_EVIDENCE_DIR=/tmp/svg-label-evidence \
CHROME_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node prototypes/svg-label/check.mjs
```

Set the executable path to your test browser. Chromium is used for the browser test
and existing HTML/CSS comparison, **not** for server-side SVG rendering.

## What it proves

The browser and Node independently consume the same V2 JSON, existing template-field
expander and the editor's bundled WOFF2 fonts. Shared JavaScript measures/shapes text with
fontkit and writes glyph paths into SVG. The same resvg WebAssembly engine rasterizes
both outputs; the same threshold/bit-packing code produces mono1. No V3 is needed for
this subset, and no browser text measurement is involved in its layout.

The comparison matrix covers five synthetic 40×30 mm presets × 203/300 DPI ×
threshold 150/200. It asserts identical SVG strings, RGBA pixels and mono1 bytes
across Node/browser. Checks also cover narrower-box wrapping, explicit
newlines, minimum font size, visible overflow errors, literal field values and QR
finder/quiet-zone pixels. Visual comparisons include accents, five information lines,
transparent logos, image cropping and inverse text. The thermal QR uses EC M, integer
modules of at least three dots and an opaque four-module quiet zone inside its slot.

Evidence includes PNGs, SVGs, packed `.mono1` files and `results.json`. The lab displays
the actual decoded mono1 pixels in its first two panels. Existing Basic is thresholded
at the selected value; the existing browser comparison is **unthresholded**, captured
at printer resolution. Those baselines are visual references, not pixel-parity claims
or a physical-printer test. The new renderer still differs in wrapping/spacing from
the existing renderers.

## Costs and limits

### Expanded compatibility check

Run `compatibility-check.mjs` with the same environment variables as `check.mjs`.
It tests every font/weight with wrap-only, wrap-and-fit and no-wrap-and-fit, plus mixed
font boxes, inline mixed fonts/bold, drawings, explicit blank lines and minimum-size
overflow. Both 203/300 DPI and thresholds 150/200 are exercised. SVG, RGBA and mono1
must agree across browser/Node, and every umlaut/character must survive fitting.

October 8 expanded run: **252 rendered cases matched exactly** (including four empty
conditional-label checks); four deliberately
undersized cases returned matching minimum-size errors. All **20** lab comparisons
also matched. These counts include both DPI and threshold combinations, not 252
distinct saved user presets.

| Capability | Prototype result |
| --- | --- |
| Space Grotesk, Roboto Condensed, Fraunces: 400/500/600/700 | Implemented |
| Space Mono: 400/500/600/700 | 400/500 use regular; 600/700 use bold, like browser font matching |
| Mixed font families, separate boxes or inline | Implemented |
| Inline regular/bold mixture, including nested font tags | Implemented |
| Square and rectangle with fill/stroke | Renders |
| Circle, line, all drawing elements together | Implemented |
| Ä Ö Ü ä ö ü ß with wrapping | Renders, characters retained |
| Shrink-to-fit with and without wrapping | Renders; minimum respected |
| Explicit blank lines | Retained |
| Content too large at minimum size | Explicit error |

The lab's **All four fonts** and **Mixed inline fonts** fixtures provide side-by-side
rasters. Mixed runs share a baseline and one wrap/fit calculation, using each face's
glyph metrics. Field values remain literal even if they contain markup delimiters.
Closed-shape strokes are inset to match CSS border-box; lines cross the box's center.

### Remaining features and real exports

The extension adds italic/underline, nested inline sizes, inverse/filament-color
backgrounds, inline/standalone swatches, borders, aligned/manual-size logos, and
migrated-V1 row collapse/flow. Cropped images use a fitted, clipped viewport so pixels
outside the crop cannot leak into letterbox margins. Enlarged inline text participates
in legacy-row height and fitting. Normal QR uses EC H and the selected center decoration,
with opaque external clearance; thermal remains undecorated EC M. Filament links are supported.

Run `saved-presets-check.mjs` with the evidence/browser variables above, after starting
the server with `LABEL_TESTER_PRESETS_DIR`. It uses four exported presets through the
application's existing normalizer/migration, plus two synthetic feature fixtures:
203/300 DPI × normal/thermal × logo present/absent = **48 comparisons**. All browser/Node
outcomes agree: **38 render identically; 10 reject**. Source SHA-256 and original format
are recorded in `saved-presets-results.json`; no input files are written.

| Export | Result with representative spool data |
| --- | --- |
| Default (V1, 12 mm QR) | Thermal rejects at 203 DPI (2 dots/module); 300 DPI and normal render |
| Test 40x30 1 (V1, 14 mm QR) | All combinations render; final article-number line retained |
| V2 SpoolmanScale print | Long bold info overflows with logo and fit disabled; explicit error, never silent line loss. Removing the logo frees enough space |
| Test tiny QR (V1, 6 mm) | Existing migration normalizes to 8 mm; thermal still rejects at both DPIs. Normal renders but scan reliability is unproven |

The exports include layout, not the original spool record or manufacturer-logo asset.
Comparisons use clearly marked representative data and a synthetic logo, not a claimed
byte-for-byte reproduction of the tester's old PNGs/physical labels. The FilaMan server's
preset endpoint required authentication, so it supplied no additional saved presets.
The lab keeps existing Basic/browser baseline results visible even when shared rendering
rejects a layout. A separately labelled fit-enabled copy of tester 4 with an explicit
1.5 mm minimum (identical inputs for all renderers) is also checked and captured; it is
not counted as an untouched-export success. The prototype now uses the editor's implicit
minimums: 2 mm for wrapping text and 0.265 mm for non-wrapping text.

### Integration costs

- Three new development dependencies: fontkit, qrcode and resvg-wasm; 34 added lockfile
  package nodes. The WASM file is about 2.4 MiB and fontkit's browser module about
  536 KiB, before other dependencies/fonts. These are file sizes, not a measured
  compressed production bundle.
- Timings in `results.json` measure warm layout+raster only. Startup, font/WASM loading,
  network and Python process launch are excluded. This is not a throughput or
  end-to-end benchmark; all 14 font faces are eagerly loaded in the lab.
- The current production Docker runtime does not contain Node. Adoption needs a
  JavaScript runtime/worker integration; it is not a drop-in Python replacement.
- Greedy wrapping differs from browser balanced wrapping. Synthetic italic, line metrics
  and normal QR decoration are approximate rather than pixel-identical to HTML/CSS.
  Non-fitting text is rejected instead of using the browser's legacy title ellipsis or
  clipping behavior. Full bidi, arbitrary editor behavior and all V2 validation are not
  implemented. This is not a production V2 importer.
- Text becomes SVG paths, so text editing/selection still needs the editor's controls
  or overlay. Browser-native SVG rendering is not claimed to match resvg pixels;
  the editor would need the same WASM preview for exact raster parity.

Verification: seventeen focused tests pass, including separator-font wrapping, empty
conditional boxes, crop isolation and legacy inline sizing; frontend type check/build pass, lint has no
errors, scoped duplication check has no clones, and the Python helper passes Ruff.
The full frontend suite has 1,283 passes and one pre-existing changelog-scope failure
about missing streaming-JSONL release notes. Production backend code is unchanged.

## Decision

The shared-renderer approach is feasible for this subset and removes the *two-layout*
problem: fonts, wrapping and rasterization have one implementation. It does not yet
prove a full editor replacement is simpler. The supplied exports now have comparison
coverage, with remaining layout differences and overflow called out. Decide which
behaviors must be retained before wiring this into production. Keep Basic/Chromium unchanged until that compatibility and
deployment cost is understood; do not build a second full compatibility framework
inside this spike.
