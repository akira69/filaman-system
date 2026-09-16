# SpoolmanScale label integration

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
Refresh the list on demand. If no preset is selected, omit `preset_id` and use
FilaMan's standard spool label. A missing or other user's preset yields `404`.
Preset IDs can disappear when users delete presets, so let the user reselect.

## Render for the scale's printer

```http
GET /api/v1/labels/spool/123/render?format=mono1&width=576&preset_id=7
Authorization: ApiKey <key>
```

`format=mono1` returns `application/octet-stream`, one bit per pixel, rows in
top-to-bottom order. Each row starts at a byte boundary; bits are most
significant first and `1` means black. Unused low bits at the end of each row
are zero. Read `X-Image-Width`, `X-Image-Height`, `X-Row-Bytes`, and
`X-Bit-Order: msb-black-1`; check that body length equals row bytes times
height before sending it to a printer. The response is a raster, **not**
printer commands. FilaMan applies the selected preset before packing.

`width` is a pixel count from 384 to 1024; the current default is 576. The
height follows the preset's label aspect ratio (or 60 × 40 mm without a
preset). For example, a 480 × 320 default label is 19,200 bytes. Configure
the printer's printable width on the scale and pass it as `width`; determine
the M220's usable width with real hardware and media. The
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

The server renderer supports the preset's label dimensions, margin, border,
logo, title and information text blocks, QR code, and color swatches. It does
not implement the browser designer's inline markup or every advanced layout
option. Verify important presets against the returned image before relying on
them for physical labels.

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

1. Save the FilaMan base URL and user API key; verify `GET /labels/presets`.
2. After resolving a spool ID, show **Print label** with preset, **Open on PC**,
   and **Print on M220**. Scan for an M220 and save its BLE address. Offer a
   printable-width control from 384 to 1024 pixels in 8-pixel steps, starting
   at 576; save the measured width on the scale.
3. For the M220, freeze the spool ID, preset ID, width, and BLE address when
   tapped. Fetch `mono1`, validate its headers, body length, and unused row
   bits, then pass the raster to the separate M-series BLE driver. Free it
   after the transfer or any failure. Never send printer bytes after a failed
   download. **Sent to printer** means BLE writes completed, not paper output.
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
