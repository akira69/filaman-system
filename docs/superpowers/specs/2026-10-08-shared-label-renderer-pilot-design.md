# Shared label renderer: end-to-end branch pilot

## Purpose and agreed scope

Make the shared SVG renderer the default for label preview, export and the existing
printing API on `codex/svg-label-prototype`. The goal is to test whether one layout
implementation can replace the current browser/Python divergence without making
deployment or editing more complicated.

The user explicitly chose branch-wide defaults instead of an opt-in feature or UI
toggle. Keep Basic and Chromium available through explicit API renderer selection
and the comparison lab until the pilot is evaluated. No automatic fallback: a shared
renderer failure must remain visible. No upstream merge, deployment to the user's
FilaMan instance, printer command, or removal of old renderers is part of this work.

This is an architectural pilot, not a claim that the prototype is production-ready.
The written design requires review before an implementation plan is prepared.

## Evidence and remaining questions

The prototype produces identical SVG, RGBA and mono1 in browser and Node. Existing
coverage includes bundled fonts, mixed styles, umlauts, wrap/fit, cropped images,
logos, shapes, swatches, borders, migrated layouts and normal/thermal QR modes.
Four tester exports have been exercised with representative data and a substitute
logo; the original spool record and logo were not included. Those comparisons are
not reproductions of the tester's physical prints.

We still need to prove real editing/export/API integration, authoritative data/asset
parity, per-request startup cost, container packaging and physical print quality.
Browser/server agreement is not proof of fidelity to old HTML/CSS layout or QR
scan reliability. The tester's long-text preset needs fitting or more space; the
pilot must report that condition rather than silently modify the saved preset.

## Architecture

One shared rendering module consumes a normalized V2 design, resolved label data,
embedded validated images, QR origin/entity context, output mode and pixel dimensions.
It uses the bundled font faces, fontkit layout/outlines and resvg WASM. Browser and
Node adapters initialize these resources; layout code has no DOM, network or database
access. Reuse existing template expansion, data builders and preset migration.
Do not create a second template language, schema version or migration pipeline.

Promote the tested rendering code out of the disposable lab into a shared module.
Keep the lab as a comparison consumer, not an application dependency. Replace
prototype-only restrictions (203/300 DPI, 10–100 mm labels) with the existing
application's validation and explicit target pixel dimensions. Respect existing
font-size defaults and minimums. Unsupported content must produce a useful error,
not silently degrade or select another renderer.

### Browser and editor

Use the shared raster for the rendered label at the requested output resolution.
Preserve current selection, keyboard access, movement, resizing, layer rules, undo,
token controls and preset persistence. Existing DOM interaction targets/handles
remain separate from printable pixels; their geometry must follow the renderer's
resolved layout, including migrated-row collapse. The raster itself must not block
input events.

Inline editing may use a transient DOM text-editing surface. Committed edits update
the shared preview; the DOM editing surface is never an export source. This avoids
rewriting the text editor as part of the renderer pilot. Rendering failures leave
the controls usable so the design can be corrected, clearly mark the preview as
invalid, and block output of stale or partial images. Discard stale asynchronous
render completions when the user edits again.

Use the existing spool and filament data adapters. Normal preview/export retains
ordinary QR decoration; thermal output uses the existing undecorated EC-M policy,
integer modules of at least three dots and opaque clearance. A normal preview is
not claimed to equal thermal output unless output mode, dimensions and threshold
are the same.

### Export and printing

PNG and thermal mono1 come from the shared raster, not an HTML screenshot of label
content. Reuse existing file-download and PDF/sheet composition code. Individual
labels placed into PDF/sheet output use the shared image; do not redesign sheet
geometry or print dialogs. Preserve physical dimensions, orientation, copies,
intentional print-grid options and existing normal-versus-sheet behavior. Editor
handles, selection, temporary editing surfaces and preview guides never print.

### Python API adapter

Add `svg` to the existing renderer selection and make it the branch's configuration
and image default. Preserve explicit Basic/Chromium configuration and requests.
Extend the existing spool render endpoint rather than add a parallel API or a new
filament endpoint. Document the deliberate default change on this branch.

Python retains authentication, permission checks, preset ownership, asset lookup,
input limits, printer-width validation and HTTP response handling. Reuse the
existing API-spool-to-designer data builder in JavaScript so the server and browser
resolve the same dates, extra fields and tokens. Supply the real request origin;
do not use the lab's fixed QR URL or representative data.

Invoke a bundled Node command once per render. Send bounded JSON through stdin;
return a bounded lossless raster response through stdout. Use a fixed executable
and entry point, no shell interpolation, and no user-directed filesystem/network
loads in the renderer. Fonts/WASM are packaged resources and images are embedded
from already-authorized, validated assets.

Reuse the existing render admission-control pattern. Enforce execution and output
limits, terminate/reap timed-out children and clean up on cancellation. Verify the
subprocess adapter under the Docker uvloop configuration, not only plain asyncio.
Known content/layout errors return 422; unavailable runtime, timeout or renderer
failure returns 503. Do not expose stack traces or return a cached success/error
from a different request.

Retain existing response finishing for rotation, printer padding/alignment, color
conversion and mono1 packing. Preserve current parameter ranges, including threshold
0–255 and DPI 100–600. SVG's initial thermal threshold default is 200, subject to
physical testing; Basic remains 200 and Chromium 150. Identify SVG output through
`X-Renderer: svg`; preserve other response headers and wire formats. Compare complete
API raster bytes against browser output after applying identical finishing settings,
not just the unpadded label image.

### Runtime and packaging

Bundle the shared Node entry point with existing frontend build tooling; do not rely
on Vite's development server or runtime TypeScript loading. Package Node, the shared
bundle, fonts and WASM in the branch image. Use the build image's Node major and
verify that exact runtime in the container. The default SVG image must render with
no Chromium installation. Keep the existing Chromium-enabled image for comparisons.

Use one Node process per render first. A persistent worker would avoid repeated
initialization but adds lifecycle/protocol complexity; defer it unless measurements
justify it. A standalone renderer service is outside this pilot. Report cold
request latency, repeated-request latency, peak memory, simultaneous-request behavior
and image-size change. Do not compare the prototype's warm rendering time with
Chromium's end-to-end request time as if they measured the same thing.

## Verification and acceptance

1. A normal user can open a saved preset, edit text and geometry, undo, save/reload
   and export using the shared default. Exercise spool and filament flows, missing
   logos, image assets, QR layering and keyboard controls. No renderer toggle required.
2. Matching browser/API input produces identical label pixels and mono1 bytes at
   203/300 DPI, with checks at existing API range boundaries and printer padding,
   orientation, threshold and row-packing boundaries. Use authoritative application
   data rather than manually duplicated strings.
3. Extend the current synthetic matrix and tester-export cases. Preserve all text
   when it fits; report explicit overflow otherwise. Keep modified fit-enabled
   examples distinct from original exports. Assert originals remain unchanged.
4. API permission, selected/default preset, asset ownership and error behavior have
   regression coverage. Explicit Basic/Chromium calls remain available. Missing Node,
   invalid payloads, oversize output, timeouts, cancellation and concurrent requests
   cannot leave runaway children or return misleading successful images.
5. A clean built container serves the editor and renders PNG/mono1 without Chromium
   or development dependencies at runtime. Record tested CPU architectures; do not
   claim untested ARM support. Measure runtime and image costs before recommending
   removal of either old renderer.
6. Verify PNG/PDF and normal/sheet print preview dimensions and absence of editor
   chrome. Run focused and relevant full tests, type check, lint, build, Python checks,
   scoped duplication checks and a fresh code review. Report unrelated existing
   failures separately; do not describe the entire suite as green when it is not.
7. Produce labelled API-generated test rasters for the tester's 40×30 mm M220 setup.
   Physical printing/scanning is a separate human acceptance step. Preparing those
   files does not authorize sending print commands or deploying to their server.

## Decision after the pilot

Keep the experimental branch separate until rendering behavior, editing usability,
deployment costs and physical results are understood. If it succeeds, propose the
smallest upstream migration/removal plan. If startup or memory costs are poor,
measure whether a persistent worker solves them before adding infrastructure.
Do not remove Basic/Chromium merely because browser and Node agree with each other.
