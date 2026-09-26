# SpoolmanScale label integration

Upstream scale project: [SpoolmanScale](https://github.com/Niko11111/SpoolmanScale).
Hardware, setup, and firmware reference: [SpoolmanScale documentation](https://niko11111.github.io/SpoolmanScale-Docs/).

FilaMan renders labels. SpoolmanScale chooses a FilaMan spool and an optional
saved spool label preset, then either sends a monochrome bitmap to its own
printer driver or asks an open FilaMan tab to show the existing print page.

## Setup and authentication

Create a **user API key** in FilaMan for the account whose designer presets and
PC session will be used. Give it `spools:read` scope. Send
`Authorization: ApiKey <key>` on every scale request. A device token with
`spools:read` can render a default label but cannot list or use user presets or
request PC printing. Keep the key out of logs and the browser.

For **PC printing only**, the PC must have a FilaMan tab open and be signed in as the **same user** as the
API key. The tab polls for pending requests and shows a prompt. Clicking
**Open print window** opens the existing spool label page. The user may choose
**Print** or **Export PDF** there. The scale should report that the request was
queued, not that a physical print succeeded.

## Preset selection

```http
GET /api/v1/labels/presets
```

This returns the configured user API key owner's saved **spool** designer
presets, for example:

```json
[{"id": 7, "name": "40 mm spool", "selected": true}]
```

`selected` is additive; existing `id` and `name` fields and preset
content/version remain unchanged. When Default is selected, every row has
`selected: false`.

Select a preset for that user with:

```http
PUT /api/v1/me/label-presets/selection
Content-Type: application/json

{"preset_id": 42}
```

Send `{"preset_id": null}` to select Default. Success returns `204 No Content`.
A principal without a user returns `403`; a missing preset, another user's
preset, or a filament/sheet preset returns `404`.

Show these names in the scale UI and store the chosen numeric `preset_id`.
The scale shows up to 10 presets as one list. With more than 10 it groups
names under A–F, G–L, M–R, S–Z, and #, and pages through each group. The
API returns up to 100 spool presets for one user. FilaMan
accepts names up to 120 characters; the scale shortens long names for its
touchscreen while retaining each numeric ID. Refresh the list on demand.
Omit `preset_id` to render the user's currently selected spool preset. If the
user has no selected preset, FilaMan uses its standard spool label. Send
`preset_id=0` to render that standard label for one request without changing the
user's selected preset. Positive IDs select a saved preset. A missing
or other user's explicit preset yields `404`.
Preset IDs can disappear when users delete presets, so let the user reselect.

## Render for the scale's printer

```http
GET /api/v1/labels/spool/123/render?format=mono1&width=576&dpi=203&align=right&orientation=landscape&preset_id=7
Authorization: ApiKey <key>
```

`format=mono1` returns `application/octet-stream`, one bit per pixel, rows in
top-to-bottom order. Each row starts at a byte boundary; bits are most
significant first and `1` means black. Unused low bits at the end of each row
are zero. Read `X-Image-Width`, `X-Image-Height`, `X-Row-Bytes`, and
`X-Bit-Order: msb-black-1`; check that body length equals row bytes times
height before sending it to a printer. The response is a raster, **not**
printer commands. `X-Content-Width` gives the unpadded image width and
`X-Rotated` is `1` when the requested orientation required a quarter turn. Use
those headers to restore the designer's original orientation in a preview.
FilaMan applies the selected preset before packing. `X-Preset-Id` identifies
the preset used; `0` means the standard spool label. The scale uses this header
to keep its cached selection in sync without fetching the preset list first.

`width` is the print row width in pixels, from 384 to 1024. The M220 scale
driver derives it from the loaded label width, using 576–600 pixels across the
selectable 20–75 mm range. With `dpi=203`, FilaMan renders the preset at its
physical millimetre size (or 60 × 40 mm without a preset) and pads each row
to `width`; `align=right` puts the image against the right edge of the M220's
right-aligned label roll. A 40 × 30 mm preset becomes about 320 × 240 pixels
inside a 576 × 240 raster. `orientation=landscape` rotates a 30 × 40 mm
portrait design to fit the same 40 × 30 mm physical label.
`orientation=portrait` applies the inverse rule for label stock that is taller
than it is wide. A label wider than the requested print row returns
`422`. Without `dpi`, rendering retains the original behaviour: the label
fills `width` and its height follows the preset aspect ratio. Configure the
loaded physical label width and feed length on the scale; the firmware
converts millimetres to 203 DPI pixels and passes the padded row width. The
[myphomemo M-series implementation](https://github.com/DeepCoreSystem/myphomemo)
is a reference for the separate BLE and raster command driver. Keep its
transport, printer initialization, and command chunking out of the FilaMan API.

Other API clients may use `format=png` (the default):

```http
GET /api/v1/labels/spool/123/render?format=png&width=576&preset_id=7&color=color
```

`color=mono` is the default. `color=color` preserves color swatches and logos
in PNG. `format=mono1&color=color` returns `422`. The scale uses only
`format=mono1` for this release; it does not offer PNG or color. All render
responses include `Cache-Control: no-store`.

The API runs the existing label preview and export code in server-side Chromium.
It uses the same fonts, template fields, rich field formatting, text fitting,
image crops, and QR generation as the editor. Saved v1 settings use the same
migration as the editor; v2 designs use the shared free-form renderer. Default
uses the existing standard label. The scale makes this request directly;
no PC or open browser tab is required.
The Chromium image runs each browser under a dedicated unprivileged user with
the browser sandbox enabled. Docker deployments must use the supplied seccomp
profile so Chromium can create its sandbox namespaces without `SYS_ADMIN` or
an unconfined container:

```bash
docker compose -f docker-compose.yml -f docker-compose.chromium.yml up -d
```

Chromium is the default renderer. Use the `-chromium` Docker image for exact
editor-preview output. A smaller fixed layout is available without a browser:

```http
GET /api/v1/labels/spool/123/render?renderer=basic&preset_id=0&format=mono1&width=576
```

Basic uses a fixed 60 × 40 mm layout with manufacturer, designation, material,
color name and swatch, remaining weight when present, spool ID, and the spool
QR link. Display text is limited to printable Latin-1. Basic supports only
Default (`preset_id=0`); it does not reproduce saved designer presets, custom
fields, logos, uploads, or free-form positions. If a saved preset is explicit
or currently selected, FilaMan returns `422`,
`X-Label-Error: preset_requires_chromium`, and a JSON explanation. It never
silently substitutes the fixed layout. Set `LABEL_RENDERER=basic` to use Basic
for existing clients that omit `renderer`; those clients must have Default
selected. A request can override the setting with `renderer=chromium`.

Uploaded images must belong to the API key's user. Missing images, text that
cannot fit, and other preview readiness errors return `422`. Fix the preset
in the designer before retrying. Printer padding, rotation, monochrome conversion,
and row packing happen after preview capture. Capture uses the requested printer
resolution instead of producing a full 600-DPI export first.

## Server runtime and memory

The default Docker tags (`latest`, version, and SHA) do not include Chromium.
They run the normal browser editor and Basic API labels. Matching
`latest-chromium`, `vX.Y.Z-chromium`, and `sha-<commit>-chromium` tags add Debian's
headless Chromium for exact API preview rendering. Changing image tags is the
only image change; the supplied Compose override also applies
`docker/chromium-seccomp.json`. Both variants otherwise expose the same app and
API and default to `LABEL_RENDERER=chromium` for compatibility. A raw Docker
launch must pass `--security-opt seccomp=./docker/chromium-seccomp.json`.
Without that profile Chromium fails closed instead of running unsandboxed.

For a source installation, install backend dependencies and the operating
system's `chromium-headless-shell` (or Chromium), then build the static frontend.
The renderer finds `frontend/dist` or `/app/static` by default.
`LABEL_RENDER_STATIC_DIR` can point to a different static build directory;
`LABEL_RENDER_CHROMIUM_EXECUTABLE` can select an installed Chromium executable.
These settings do not change the scale request.

Chromium starts on demand and closes after each render. A shared file lock permits
one render across server workers, before image blobs are loaded. Busy requests
receive `503` with `Retry-After: 1`; retry the render GET after that delay.
Timeouts also include that retry hint. A Chromium request in the browserless
image returns a clear `503` without a retry hint; install the Chromium image or
request Basic Default. The browser receives only
the static build and authorized image bytes; external network access is blocked.

The final raster is at most 1024 pixels wide and 2048 pixels high. Images and QR
codes share a conservative 12-megapixel budget: each occurrence of an uploaded
image or manufacturer logo counts its source pixels, and each QR reserves its
maximum 1024²-pixel canvas. Exceeding this budget returns `422`; resize source
images or simplify the preset. Manufacturer logos are also limited to 2 MB of
encoded input and the existing safe image decoder limits.

Label downloads are small: a 480 × 320 `mono1` raster is 19,200 bytes. Runtime RAM
is separate from file size and from the complete application's RAM. In isolated
Linux measurements, direct headless Chromium peaked near 116 MiB for a standard
label and 317 MiB with a 12-megapixel image. Those are observations under the
test's browser, fonts, container limit, and inputs, not hard guarantees. Basic
adds only the Pillow/QR rendering work and no browser process. There is no idle
Chromium process. The final local ARM64 images measured about 722 MB without
Chromium and 1.48 GB with it (Docker's unpacked image size), so the optional
browser added about 761 MB. The QR package itself is a roughly 46 KB wheel;
Pillow was already an application dependency. Allow headroom for the app and
concurrent non-render work.

## Ask the PC to print or generate a PDF

```http
POST /api/v1/labels/spool/123/print-request?preset_id=7
Authorization: ApiKey <key>
```

The `201` response is `{"id": 42, "spool_id": 123, "preset_id": 7}`.
`preset_id` is optional and returns `null` when omitted. The request is owned
by the API key's user, lasts five minutes, and appears only in that user's
open FilaMan tabs. One tab claims it when a person clicks the prompt. The
opened label page loads the requested designer preset, then lets the person
use **Print** or **Export PDF**. Browser popup rules require the click, so a
scale cannot silently open a system print dialog.

The browser uses these endpoints; scale firmware does not need to call them:

```text
GET  /api/v1/labels/print-requests/pending
POST /api/v1/labels/print-requests/{id}/claim
```

The pending endpoint returns the oldest pending request or JSON `null`; claim
returns `204` once and `409` for a duplicate, expired, or missing request.

## Scale flow and checks

1. Save the FilaMan base URL and user API key; verify
   `GET /api/v1/labels/presets`.
2. In printer settings, select a preset from the list or alphabetical groups.
   After resolving a spool ID, show **Print label**, preview, **Open on PC**,
   and **Print on M220**. Scan for an M220 and save its BLE name and address.
   Let the user choose the loaded label size as width across the printer × feed
   length in millimetres. Common sizes are one tap; custom sizes allow 20–75 mm
   width and 10–150 mm feed length. Keep raster pixels out of the settings UI.
   The default 60 × 40 mm label can be opened on the PC but does not fit 40 ×
   30 mm stock; the scale disables M220 printing until a fitting preset is
   selected.
3. For the M220, freeze the spool ID, preset ID, loaded media size, and BLE
   address when tapped. Fetch `mono1` with `dpi=203&align=right`; request
   `orientation=landscape` when width is at least the feed length and
   `orientation=portrait` otherwise. Validate its headers, body length, and
   unused row bits, then pass the raster to the separate M-series BLE driver.
   Free it after the transfer or any failure. Never send printer bytes after a failed
   download. Accept only content whose 203 DPI dimensions match the configured
   loaded label size before print-head padding. **Sent to printer** means BLE writes
   completed, not paper output.
4. For a PC, POST `print-request`, show a queued state, and tell the user to
   approve the prompt in the signed-in FilaMan tab. The PC user chooses Print
   or Export PDF. A queued response is not printer confirmation.

Handle `401` by checking the key, `403` by checking its scope or user-key
requirement, `404` by refreshing the spool or preset, and `422` by correcting
format, width, or preset data. A `503` render response indicates a busy or
unavailable renderer; honor `Retry-After` when present. Do not automatically retry a PC request;
duplicate requests can produce multiple prompts.

Before release, test one preset at the measured printer width, compare the
monochrome output with the browser label, verify row packing on a partial-byte
width, verify the PDF action in the PC window, and verify that a second user
never sees the request.
