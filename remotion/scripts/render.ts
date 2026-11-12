import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { STILL_RENDER_OPTS, stillPath } from './still-opts';
import { nextTrialFile, readScreenrecProject, screenrecLayout } from './screenrec-plan';

/**
 * 用法:
 *   render.ts <filmDir> --stills 1.5,4.2,9   每个秒数渲一张 <filmDir>/stills/<秒>.jpg(半尺寸)
 *   render.ts <filmDir> --out <mp4>          渲整片
 *   render.ts --screenrec <project.config.json> --keys [秒,...]
 *   render.ts --screenrec <project.config.json> --film [输出目录]
 * 片子目录必须有 index.tsx(registerRoot, 合成 id = Film) 与 public/。
 * 产品录屏3D 用 remotion/screenrec/src/index.tsx，props 来自该项目 work/build/props.json。
 */

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

async function renderScreenrec(argv: string[]) {
  const cfgArg = argv[0];
  if (!cfgArg || cfgArg.startsWith('--')) throw new Error('用法: render.ts --screenrec <project.config.json> --keys [秒,...] | --film [输出目录]');
  let keys: string | true | undefined;
  let film: string | true | undefined;
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    const hasVal = next !== undefined && !next.startsWith('--');
    if (flag === '--keys') {
      keys = hasVal ? next : true;
      if (hasVal) i++;
    } else if (flag === '--film') {
      film = hasVal ? next : true;
      if (hasVal) i++;
    } else throw new Error(`未知参数 ${flag}`);
  }
  if ((keys === undefined) === (film === undefined)) throw new Error('用 --keys 或 --film');
  const root = repoRoot();
  const project = readScreenrecProject(path.resolve(cfgArg), root);
  if (!fs.existsSync(project.props)) throw new Error(`没有 ${project.props}，先跑配音和 build`);
  if (!fs.existsSync(project.publicDir)) throw new Error(`没有 ${project.publicDir}，先跑 build`);
  const inputProps = JSON.parse(fs.readFileSync(project.props, 'utf8')) as Record<string, unknown>;
  const t0 = Date.now();
  const serveUrl = await bundle({ entryPoint: screenrecLayout(root).entry, publicDir: project.publicDir });
  const composition = await selectComposition({ serveUrl, id: 'Film', inputProps });
  if (keys !== undefined) {
    const times = keys === true ? project.cfg.verify?.keyTimes : keys.split(',').map(Number);
    if (!times?.length || times.some((n) => !Number.isFinite(n))) throw new Error('没有关键帧时间：在配置 verify.keyTimes 里写，或 --keys 0,1,4');
    fs.mkdirSync(project.keyframes, { recursive: true });
    for (const s of times) {
      const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(s * composition.fps)));
      const output = path.join(project.keyframes, `kf_${String(s).padStart(4, '0')}.png`);
      await renderStill({ composition, serveUrl, output, frame, inputProps, imageFormat: 'png' });
      console.log(`still ${output}`);
    }
  } else {
    const dir = typeof film === 'string' ? path.resolve(film) : process.env.FILMS_DIR ? path.resolve(process.env.FILMS_DIR) : project.layout.outDir;
    fs.mkdirSync(dir, { recursive: true });
    const out = nextTrialFile(dir, project.cfg.name, project.cfg.formatTag, (p) => fs.existsSync(p));
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      crf: 18,
      audioCodec: 'aac',
      outputLocation: out,
      onProgress: ({ progress }) => {
        const p = Math.floor(progress * 10);
        if (p !== last) {
          last = p;
          console.log(`progress ${p * 10}%`);
        }
      },
    });
    console.log(`out ${out}`);
  }
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--screenrec') {
    await renderScreenrec(argv.slice(1));
    return;
  }
  const [filmDirArg, flag, value] = argv;
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
