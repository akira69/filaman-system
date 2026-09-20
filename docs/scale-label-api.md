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

The PC must have a FilaMan tab open and be signed in as the **same user** as the
API key. The tab polls for pending requests and shows a prompt. Clicking
**Open print window** opens the existing spool label page. The user may choose
**Print** or **Export PDF** there. The scale should report that the request was
queued, not that a physical print succeeded.

## Preset selection

`GET /api/v1/labels/presets` returns the user's saved **spool** designer
presets, for example:

```json
[{"id": 7, "name": "40 mm spool"}]
```

Show these names in the scale UI and store the chosen numeric `preset_id`.
The scale shows up to 10 presets as one list. With more than 10 it groups
names under A–F, G–L, M–R, S–Z, and #, and pages through each group. The
API returns up to 100 spool presets for one user. FilaMan
accepts names up to 120 characters; the scale shortens long names for its
touchscreen while retaining each numeric ID. Refresh the list on demand.
If no preset is selected, omit `preset_id` and use
FilaMan's standard spool label. A missing or other user's preset yields `404`.
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
FilaMan applies the selected preset before packing.

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

The current designer saves `data.settings` presets. The server renders their
label dimensions, margin, border, logo, title and information text blocks, QR
code, and color swatches. The new designer saves `data.version=2` with
`data.design`; the server also renders its positioned text, QR, manufacturer
logo, uploaded image, swatch, and shape elements without changing the editor.
Uploaded images must still belong to the API key's user. Missing uploaded images and
invalid geometry return `422` rather than a blank label. The server uses
Pillow's default font, and does not reproduce every browser font, text markup,
wrapping, or decorated QR variant. Compare important presets against the
returned PNG before relying on the monochrome print.

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
format, width, or preset data. Do not automatically retry a PC request;
duplicate requests can produce multiple prompts.

Before release, test one preset at the measured printer width, compare the
monochrome output with the browser label, verify row packing on a partial-byte
width, verify the PDF action in the PC window, and verify that a second user
never sees the request.
