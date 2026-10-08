import path from 'node:path';
import fs from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { STILL_RENDER_OPTS, stillPath } from './still-opts';

/**
 * 用法:
 *   render.ts <filmDir> --stills 1.5,4.2,9   每个秒数渲一张 <filmDir>/stills/<秒>.jpg(半尺寸)
 *   render.ts <filmDir> --out <mp4>          渲整片
 * 片子目录必须有 index.tsx(registerRoot, 合成 id = Film) 与 public/。
 */
async function main() {
  const [filmDirArg, flag, value] = process.argv.slice(2);
  if (!filmDirArg || !flag || !value) throw new Error('用法: render.ts <filmDir> --stills <秒,...> | --out <mp4>');
  const filmDir = path.resolve(filmDirArg);
  const t0 = Date.now();
  const serveUrl = await bundle({ entryPoint: path.join(filmDir, 'index.tsx'), publicDir: path.join(filmDir, 'public') });
  const composition = await selectComposition({ serveUrl, id: 'Film' });

  if (flag === '--stills') {
    const dir = path.join(filmDir, 'stills');
    // 清不清上一轮由 mp film render 决定(全部重出才清; --shots 只重出几镜时保留其余的)
    fs.mkdirSync(dir, { recursive: true });
    for (const s of value.split(',').map(Number)) {
      const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(s * composition.fps)));
      const output = stillPath(dir, s);
      await renderStill({ composition, serveUrl, output, frame, ...STILL_RENDER_OPTS });
      console.log(`still ${output}`);
    }
  } else if (flag === '--out') {
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: 18,
      outputLocation: path.resolve(value),
      onProgress: ({ progress }) => {
        const p = Math.floor(progress * 10);
        if (p !== last) {
          last = p;
          console.log(`progress ${p * 10}%`);
        }
      },
    });
    console.log(`out ${path.resolve(value)}`);
  } else {
    throw new Error(`未知参数 ${flag}`);
  }
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
