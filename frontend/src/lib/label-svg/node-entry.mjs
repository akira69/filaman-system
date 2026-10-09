import { readFile } from 'node:fs/promises';
import { createSvgRuntime } from './runtime.mjs';
import { renderSvgLabel } from './core.mjs';
import { prepareSvgApiInput } from './prepare-api.ts';

let kind = 'layout';
try {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 96 * 1024 * 1024) throw new Error('Label input exceeds renderer budget');
    chunks.push(chunk);
  }
  const { payload, origin, assets } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const input = prepareSvgApiInput(payload, origin, assets);
  kind = 'internal';
  const runtime = await createSvgRuntime(path => readFile(new URL(`./resources/${path}`, import.meta.url)));
  const logo = await readFile(new URL('./resources/logo-qr.png', import.meta.url));
  input.assets.qrLogo = { dataUrl: `data:image/png;base64,${logo.toString('base64')}`, width: logo.readUInt32BE(16), height: logo.readUInt32BE(20) };
  kind = 'layout';
  const output = renderSvgLabel(input, runtime);
  process.stdout.write(JSON.stringify({ png: Buffer.from(output.png).toString('base64') }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: { kind, message: kind === 'layout' ? String(error.message).slice(0, 300) : 'Shared label runtime unavailable' } }));
}
