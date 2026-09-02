import fs from 'fs';
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
/**
 * 一句字幕。与 `remotion/src/Film.tsx` 里的 `CaptionItem` 逐字段同形——**不
 * import**, 理由同上(独立子项目)。也与 `ass-captions.ts` 的 `CaptionEvent`
 * 同形不同名, 这是有意的: 两者服务不同的渲染管线(ASS 字幕滤镜 vs Remotion
 * 组件), 刻意不复用同一个类型名, 避免调用方误以为可以互相赋值。
 */
export type CaptionItem = { text: string; startMs: number; endMs: number };

export type FilmInput = {
  shots: unknown[];
  audioSrc: string | null; // 人声, staticFile 相对路径; renderFilm 负责填入
  bgm: { src: string; volume: number } | null; // BGM, loop 到片长; renderFilm 负责填入
  captions: CaptionItem[]; // 逐句字幕
  aspect: '16:9' | '9:16';
};

/**
 * 空白槽位预检(审查 Important #2)。
 *
 * 这条规则在两处各实现一份、刻意不共享代码: `remotion/src/cards/guard.ts`
 * 的 `assertContent` 是渲染时组件里的最后一道兜底(万一将来有调用方绕过
 * `renderFilm` 直接拿 Film.tsx 去渲染), 这里是 `renderMedia` 之前的一次性
 * 体检。**两处是同一条规则的两处实现, 改一处要改另一处。** 不能 import
 * 共享是因为 `remotion/` 是独立子项目, 主项目 tsc 编译不到它的依赖(Task 1
 * 已经踩过这个坑)。
 *
 * 为什么要在渲染前查, 而不是等组件里的 `assertContent` 抛错: 组件抛错要等
 * `renderMedia` 推进到对应帧才触发——如果坏镜头排在后面, 前面几个镜头已经
 * 白白编码过一遍才失败, 而且一次只报一个槽位, 修一个、重跑、再报下一个。
 * 这里一次扫完全部 shots, 一次列出所有问题槽位, 渲染还没开始就能失败。
 */
const isBlank = (v: unknown): boolean => typeof v !== 'string' || v.trim().length === 0;

type ShotLike = { shotId?: unknown; card?: unknown; slots?: Record<string, unknown> };

function findBlankSlots(shots: unknown[]): string[] {
  const problems: string[] = [];
  for (const raw of shots) {
    const shot = raw as ShotLike;
    const shotId = typeof shot.shotId === 'string' ? shot.shotId : '(shotId 缺失)';
    const card = shot.card;
    const slots = shot.slots ?? {};
    const bad = (field: string) => problems.push(`${shotId} [${String(card)}].${field}`);

    // 与 shot-plan.ts 的 CARD_TYPES/SLOTS 对应: 每种卡片必填的字符串字段,
    // 就是各卡片组件里调用 assertContent 的那几个字段。
    switch (card) {
      case 'statement':
        if (isBlank(slots.text)) bad('text');
        break;
      case 'stat':
        if (isBlank(slots.label)) bad('label');
        break;
      case 'contrast':
        if (isBlank(slots.leftLabel)) bad('leftLabel');
        if (isBlank(slots.leftText)) bad('leftText');
        if (isBlank(slots.rightLabel)) bad('rightLabel');
        if (isBlank(slots.rightText)) bad('rightText');
        break;
      case 'list': {
        if (isBlank(slots.title)) bad('title');
        const items = slots.items;
        if (Array.isArray(items)) {
          items.forEach((item, i) => {
            if (isBlank(item)) problems.push(`${shotId} [list].items[${i}]`);
          });
        } else {
          problems.push(`${shotId} [list].items 缺失或不是数组`);
        }
        break;
      }
      default:
        // 未知卡片类型不在这里管——那是 CARD_TYPES/CARDS 注册表对齐的事,
        // 有 card-registry.test.ts 守着, 这里只管"内容是不是空白"。
        break;
    }
  }
  return problems;
}

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

/**
 * `remotion/public/` 是唯一 `staticFile` 认得的根——TTS 人声/BGM 却落在
 * `productionRoot` 下(任意绝对路径), 所以每次渲染前要把这两个文件拷进
 * `remotion/public/render-assets/`, 渲染结束(不论成败)再删掉, 不然会在
 * public 目录里越攒越多垃圾。
 *
 * 文件名派生自 outputPath 的**父目录名 + basename**——vp id 只出现在父目录
 * 名(`productionRoot` 下按 vp 分的目录), `basename(outputPath)` 本身是
 * `preview.mp4`/`master.mp4` 这种常量文件名, 不带 vp id(复审 2026-09-03
 * 发现: 之前的注释错误地假设 outputPath 的 basename 本身带 vp id, 实际上两个
 * 不同 vp 并发渲 master 会撞向同一个 `render-assets/master-voice.wav`, 一边
 * 的 finally 清理还可能删掉另一边正在读的文件)。防并发靠父目录名(vp id)
 * 参与派生 —— 当前队列 concurrency=1、单 worker 进程, 今天不会真的撞上,
 * 这层保护是为未来把 concurrency 调大预留的。
 */
const RENDER_ASSETS_DIR = path.resolve(process.cwd(), 'remotion/public/render-assets');

/**
 * 把一个绝对路径的音频文件拷进 `render-assets/`, 返回喂给 `staticFile` 的
 * 相对路径。**拷贝失败直接抛错、不吞掉**——调用方(renderFilm)不做降级,
 * 因为一半有声一半无声的成片比直接渲染失败更糟, 前者不容易被发现。
 */
// 导出仅供单测用: 直接验证"不同父目录 + 同名 basename → 不同中转文件名"这条
// 防并发规则, 不用为了测个文件名派生逻辑去真的跑一次 renderMedia。
export function copyIntoRenderAssets(
  srcAbsPath: string,
  outputPath: string,
  kind: 'voice' | 'bgm',
): { absPath: string; relPath: string } {
  const ext = path.extname(srcAbsPath) || '.wav';
  // 父目录名(vp id) + basename 共同派生——见上方 RENDER_ASSETS_DIR 注释:
  // 只用 basename(outputPath) 不足以防并发, outputFileName 在 worker 侧是
  // 'preview.mp4'/'master.mp4' 这种常量。
  const dirName = path.basename(path.dirname(outputPath));
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const fileName = `${dirName}-${baseName}-${kind}${ext}`;
  const absPath = path.join(RENDER_ASSETS_DIR, fileName);
  fs.mkdirSync(RENDER_ASSETS_DIR, { recursive: true });
  try {
    fs.copyFileSync(srcAbsPath, absPath);
  } catch (err) {
    throw new Error(
      `[renderFilm] 中转音频文件失败(${kind}): ${srcAbsPath} -> ${absPath}: ${(err as Error).message}`,
    );
  }
  return { absPath, relPath: `render-assets/${fileName}` };
}

export async function renderFilm(opts: {
  input: FilmInput;
  outputPath: string;
  durationInFrames: number;
  fps?: number;
  /** 人声的**绝对路径**。renderFilm 负责拷进 remotion/public 并在渲染后清理。 */
  audioFile?: string | null;
  /** BGM 的**绝对路径**与音量。renderFilm 负责拷进 remotion/public 并在渲染后清理。 */
  bgmFile?: { path: string; volume: number } | null;
}): Promise<void> {
  const problems = findBlankSlots(opts.input.shots);
  if (problems.length > 0) {
    throw new Error(
      `[渲染前预检失败] 以下槽位是空白或缺失, 未进入 renderMedia:\n${problems
        .map((p) => `  - ${p}`)
        .join('\n')}`,
    );
  }

  // 中转文件的绝对路径, 只在成功拷贝后才收进来——拷贝失败时该文件根本没
  // 落地, finally 不需要(也不能)清理一个不存在的东西。
  const copiedAbsPaths: string[] = [];
  const input: FilmInput = { ...opts.input };

  try {
    if (opts.audioFile) {
      const dest = copyIntoRenderAssets(opts.audioFile, opts.outputPath, 'voice');
      copiedAbsPaths.push(dest.absPath);
      input.audioSrc = dest.relPath;
    }
    if (opts.bgmFile) {
      const dest = copyIntoRenderAssets(opts.bgmFile.path, opts.outputPath, 'bgm');
      copiedAbsPaths.push(dest.absPath);
      input.bgm = { src: dest.relPath, volume: opts.bgmFile.volume };
    }

    const serveUrl = await getBundle();
    const id = input.aspect === '9:16' ? 'portrait' : 'landscape';
    const composition = await selectComposition({
      serveUrl, id, inputProps: input as unknown as Record<string, unknown>,
    });
    await renderMedia({
      composition: { ...composition, durationInFrames: opts.durationInFrames, fps: opts.fps ?? 30 },
      serveUrl,
      codec: 'h264',
      outputLocation: opts.outputPath,
      inputProps: input as unknown as Record<string, unknown>,
    });
  } finally {
    // 渲染失败也要清理——中转文件是渲染这一次性用的, 不是持久资产。
    for (const absPath of copiedAbsPaths) {
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }
  }
}
