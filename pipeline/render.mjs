// node render.mjs <build/slug> [--stills 5,12,30] [--out film.mp4] [--max-sec 8]
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dirArg = argv[0];
if (!dirArg || dirArg.startsWith('--')) {
  throw new Error('用法: node render.mjs <build/slug> [--stills 5,12,30] [--out film.mp4] [--max-sec 8]');
}
let stills = null;
let out = null;
let maxSec = null;
for (let i = 1; i < argv.length; i++) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (flag === '--stills') stills = value;
  else if (flag === '--out') out = value;
  else if (flag === '--max-sec') maxSec = Number(value);
  else throw new Error(`未知参数 ${flag}`);
  i++;
}
if (!stills && !out) throw new Error('需要 --stills 或 --out');

const dir = path.resolve(dirArg);
const inputProps = JSON.parse(fs.readFileSync(path.join(dir, 'props.json'), 'utf8'));
const browserExecutable = process.env.REMOTION_BROWSER || process.env.CHROME || undefined;
const envConcurrency = Number(process.env.REMOTION_CONCURRENCY || 0);
const concurrency = envConcurrency > 0 ? envConcurrency : Math.max(1, Math.min(4, os.cpus().length));
const chromiumOptions = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(here, 'src/index.tsx'), publicDir: path.join(dir, 'public') });
const composition = await selectComposition({ serveUrl, id: 'Film', inputProps, browserExecutable, chromiumOptions });
const shared = { composition, serveUrl, inputProps, browserExecutable, chromiumOptions };

if (stills) {
  const stillDir = path.join(dir, 'stills');
  fs.mkdirSync(stillDir, { recursive: true });
  for (const s of stills.split(',').map(Number)) {
    const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(s * composition.fps)));
    const output = path.join(stillDir, `${s}.jpg`);
    await renderStill({ ...shared, output, frame, imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5 });
    console.log('still', output);
  }
}
if (out) {
  const lastFrame = composition.durationInFrames - 1;
  const cap = maxSec ? Math.min(lastFrame, Math.max(0, Math.round(maxSec * composition.fps) - 1)) : lastFrame;
  let last = -1;
  await renderMedia({
    ...shared,
    codec: 'h264',
    crf: 18,
    audioCodec: 'aac',
    concurrency,
    frameRange: [0, cap],
    outputLocation: path.resolve(out),
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10);
      if (p !== last) {
        last = p;
        console.log(`progress ${p * 10}%`);
      }
    },
  });
  console.log('out', path.resolve(out));
}
console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s  composition ${composition.durationInFrames}f`);
