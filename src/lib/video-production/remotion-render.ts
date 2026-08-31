import path from 'path';
import { createRequire } from 'module';

/**
 * `@remotion/bundler` / `@remotion/renderer` 故意不在主项目依赖图里
 * (React 19 与主项目 React 18 冲突; 原生 compositor 二进制和这两个包内部的动态
 * require 还会被 Next.js 构建的静态分析扫到, 有被误打进产物的风险)。
 *
 * 所以不能写成普通 `import '@remotion/bundler'` —— 主项目 node_modules 里根本没有
 * 这两个包。用 `createRequire` 从 `remotion/package.json` 所在目录发起解析, 借
 * Node 自己"从指定路径向上找 node_modules"的规则, 直接找到 remotion/node_modules
 * 里的实际安装, 不需要符号链接、不需要改主项目 package.json。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 见上方注释: 这两个包的类型声明
// 也不在主项目 node_modules 里, `typeof import(...)` 会让 tsc 去解析同一个找不到的模块。
const remotionRequire: (specifier: string) => any = createRequire(
  path.resolve(process.cwd(), 'remotion/package.json'),
);
const { bundle } = remotionRequire('@remotion/bundler');
const { selectComposition, renderMedia } = remotionRequire('@remotion/renderer');

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
    // bundle() 现在来自 createRequire, 类型是 any —— any 赋值不会把 bundlePromise
    // 的控制流类型收窄, 这里显式转成 Promise<string> 避免 return 处报 "可能是 null"。
    bundlePromise = bundle({
      entryPoint: path.resolve(process.cwd(), 'remotion/src/index.ts'),
    }) as Promise<string>;
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
