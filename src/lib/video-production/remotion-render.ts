import path from 'path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';

/**
 * 传给 Remotion 合成的 inputProps。
 *
 * **两侧各定义一份, 不跨项目 import。** `remotion/` 有独立的 package.json,
 * `remotion` 这个包不在主项目 node_modules 里 —— 主项目 `tsc --noEmit` 会去编译
 * 被 import 的 Film.tsx, 撞上 `Cannot find module 'remotion'` 直接失败。
 * 这本来就是一道 JSON 边界(inputProps), 真正的契约由后续任务的 zod schema 保证。
 */
export type FilmInput = {
  shots: unknown[];
  audioSrc: string | null;
  aspect: '16:9' | '9:16';
};

/**
 * Remotion 渲染入口(二十五期)。
 *
 * **bundle 必须缓存。** 实测 bundle 一次 0.8 秒, 而一条 64 秒片子渲染 36~48 秒 ——
 * 每条片子重新 bundle 看似只多 0.8 秒, 但 worker 是长驻进程, 一天几十条累积起来是
 * 纯浪费, 而且 bundle 期间 CPU 与渲染争抢。同一进程内 bundle 一次即可, 两个
 * composition(横屏/竖屏)共用同一份产物 —— 这条也实测过。
 */
let bundlePromise: Promise<string> | null = null;

export async function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.resolve(process.cwd(), 'remotion/src/index.ts'),
    });
  }
  return bundlePromise;
}

export async function renderFilm(opts: {
  input: FilmInput;
  outputPath: string;
  durationInFrames: number;
  fps?: number;
}): Promise<void> {
  const serveUrl = await getBundle();
  const id = opts.input.aspect === '9:16' ? 'portrait' : 'landscape';
  const composition = await selectComposition({
    serveUrl, id, inputProps: opts.input as unknown as Record<string, unknown>,
  });
  await renderMedia({
    composition: { ...composition, durationInFrames: opts.durationInFrames, fps: opts.fps ?? 30 },
    serveUrl,
    codec: 'h264',
    outputLocation: opts.outputPath,
    inputProps: opts.input as unknown as Record<string, unknown>,
  });
}
