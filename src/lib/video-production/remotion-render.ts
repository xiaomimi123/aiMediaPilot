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
  /**
   * 卡面视觉风格(二十九期 Task 1)——与 `remotion/src/Film.tsx` 的 `FilmInput.visualStyle`
   * 逐字段同形，**不 import**（独立子项目，理由同上）。`'card'` 是四张卡目前的默认
   * 配色，`'illustration'` 是给 illustration-tts 迁移用的暖纸/手写感配色，具体 token
   * 见 `remotion/src/theme.ts`。刻意必填：逼调用点显式想清楚这条片子该用哪套风格。
   */
  visualStyle: 'card' | 'illustration';
  /**
   * 出镜视频层(二十九期 Task 3)——与 `remotion/src/Film.tsx` 的
   * `FilmInput.sourceVideo` 逐字段同形，**不 import**（独立子项目，理由同上）。
   * `renderFilm` 负责把 `sourceVideoFile`(绝对路径)拷进 `render-assets/` 并
   * 填入这里的 `src`(相对路径)。
   */
  sourceVideo: {
    src: string;
    layout: 'cutaway' | 'pip';
    pip: { position: 'tl' | 'tr' | 'bl' | 'br'; scale: number; margin: number } | null;
  } | null;
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
 * `renderAssetsDir` **必须是 `getBundle()` 返回的 bundle 输出目录下的
 * `public/render-assets/`, 不能是源码里的 `remotion/public/render-assets/`**。
 *
 * 复审 2026-09-03 实测揪出的坑(比最初以为的"新文件 404"更严重, 是**静默
 * 错配**): `@remotion/bundler` 的 `bundle()`(`@remotion/bundler/dist/bundle.js`
 * 的 `copyDir({src: <remotion>/public, dest: <outDir>/public})`)只在被调用的
 * 那一刻把 `remotion/public/` 拷一次快照进 webpack 输出目录, 之后不会再同步。
 * `renderMedia`/`selectComposition` 的静态服务器(serve-handler)是"实时读盘",
 * 但读的是**那份快照目录**, 不是源码里的 `remotion/public/`。`getBundle()`
 * 按进程缓存(下面 `bundlePromise`), 只有触发第一次 `bundle()` 调用的那次渲染
 * 才会让"写入源码 public 目录"和"静态服务器实际读的目录"重合——之后同一进程
 * 里任何新拷贝的动态资源(人声/BGM/出镜视频)写进源码 `remotion/public/
 * render-assets/` 都不会被看见。
 *
 * 实测复现过两种失败形态:
 * 1. 派生出**不同**文件名 → 静态服务器 404(找不到这个新文件)。
 * 2. 派生出**相同**文件名、内容被覆盖(比如同一条流水线复用输出路径)→
 *    静态服务器读到的是快照里那份**陈旧内容**, 没有任何报错, 成片音频/画面
 *    悄悄对不上——这比 404 更危险, 因为看起来渲染成功了。
 *
 * 修法: 不写源码 `remotion/public/`, 改写**`getBundle()` 返回的那个目录**
 * 自己的 `public/render-assets/` 子目录——静态服务器实时读盘读的正是这里,
 * 写哪读哪从此是同一个目录, 404 和错配一起解决。`bundle()` 缓存策略不动
 * (仍然只 bundle 一次, 0.8s 成本继续省), 因为问题根源是"写错了目录", 不是
 * "bundle 该不该缓存"。
 */
function renderAssetsDirFor(bundleOutDir: string): string {
  return path.join(bundleOutDir, 'public', 'render-assets');
}

/**
 * 把一个绝对路径的音频/视频文件拷进 `renderAssetsDir`(调用方必须传入
 * `getBundle()` 输出目录下的 `public/render-assets/`, 见上方
 * `renderAssetsDirFor` 注释), 返回喂给 `staticFile` 的相对路径。**拷贝失败
 * 直接抛错、不吞掉**——调用方(renderFilm)不做降级, 因为一半有声一半无声的
 * 成片比直接渲染失败更糟, 前者不容易被发现。
 */
// 导出仅供单测用: 直接验证"不同父目录 + 同名 basename → 不同中转文件名"这条
// 防并发规则, 不用为了测个文件名派生逻辑去真的跑一次 renderMedia。
export function copyIntoRenderAssets(
  srcAbsPath: string,
  outputPath: string,
  kind: 'voice' | 'bgm' | 'video',
  renderAssetsDir: string,
): { absPath: string; relPath: string } {
  const ext = path.extname(srcAbsPath) || '.wav';
  // 父目录名(vp id) + basename 共同派生——只用 basename(outputPath) 不足以
  // 防并发, outputFileName 在 worker 侧是 'preview.mp4'/'master.mp4' 这种常量,
  // vp id 只出现在 outputPath 的父目录名里(复审 2026-09-03 发现, 见 git log)。
  const dirName = path.basename(path.dirname(outputPath));
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const fileName = `${dirName}-${baseName}-${kind}${ext}`;
  const absPath = path.join(renderAssetsDir, fileName);
  fs.mkdirSync(renderAssetsDir, { recursive: true });
  // 出镜视频文件通常比人声/BGM 大出两个数量级(spike: 358MB vs 几 MB) ——
  // spike 在本机 APFS 同卷下实测 0.5s 内(clonefile), 但换机器/换卷(比如跨卷
  // 挂载、非 APFS 文件系统)未必, 这里量出来打日志留痕, 而不是假设永远够快。
  const t0 = kind === 'video' ? Date.now() : null;
  try {
    fs.copyFileSync(srcAbsPath, absPath);
  } catch (err) {
    throw new Error(
      `[renderFilm] 中转${kind === 'video' ? '出镜视频' : '音频'}文件失败(${kind}): ${srcAbsPath} -> ${absPath}: ${(err as Error).message}`,
    );
  }
  if (t0 !== null) {
    const elapsedMs = Date.now() - t0;
    const sizeBytes = fs.statSync(absPath).size;
    // eslint-disable-next-line no-console -- 有意打日志: 大文件拷贝耗时是运维需要看到的信号,
    // 不是调试噪音, 见上方注释。
    console.log(
      `[renderFilm] 出镜视频中转拷贝耗时 ${elapsedMs}ms(${(sizeBytes / 1024 / 1024).toFixed(1)}MB): ${srcAbsPath} -> ${absPath}`,
    );
  }
  return { absPath, relPath: `render-assets/${fileName}` };
}

export async function renderFilm(opts: {
  input: FilmInput;
  outputPath: string;
  durationInFrames: number;
  fps?: number;
  /** 人声的**绝对路径**。renderFilm 负责拷进 bundle 输出目录的 public 并在渲染后清理。 */
  audioFile?: string | null;
  /** BGM 的**绝对路径**与音量。renderFilm 负责拷进 bundle 输出目录的 public 并在渲染后清理。 */
  bgmFile?: { path: string; volume: number } | null;
  /**
   * 出镜视频的**绝对路径**(二十九期 Task 3)。renderFilm 负责拷进 bundle
   * 输出目录的 public 并在渲染后清理，与 `audioFile`/`bgmFile` 同一惯例。
   * 只负责搬文件——`opts.input.sourceVideo` 里的 `layout`/`pip` 由调用方
   * (Task 4 的 worker)决定, 这里不判断、不改写。
   */
  sourceVideoFile?: string | null;
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

  // **必须先拿到 bundle 输出目录, 再拷动态资产**——见 `renderAssetsDirFor`
  // 顶部注释: 静态服务器实时读盘读的是这个目录下的 `public/render-assets/`,
  // 不是源码里的 `remotion/public/render-assets/`。`getBundle()` 本身仍然
  // 按进程缓存(第二次调用直接返回缓存值, 不会重新 bundle), 这里提前调用
  // 不产生额外成本, 只是把"拷贝目标目录"和"bundle 输出目录"绑死。
  const bundleOutDir = await getBundle();
  const renderAssetsDir = renderAssetsDirFor(bundleOutDir);

  try {
    if (opts.audioFile) {
      const dest = copyIntoRenderAssets(opts.audioFile, opts.outputPath, 'voice', renderAssetsDir);
      copiedAbsPaths.push(dest.absPath);
      input.audioSrc = dest.relPath;
    }
    if (opts.bgmFile) {
      const dest = copyIntoRenderAssets(opts.bgmFile.path, opts.outputPath, 'bgm', renderAssetsDir);
      copiedAbsPaths.push(dest.absPath);
      input.bgm = { src: dest.relPath, volume: opts.bgmFile.volume };
    }
    if (opts.sourceVideoFile) {
      // `opts.input.sourceVideo` 里的 layout/pip 是调用方(worker)已经决定好的,
      // 这里只管把文件搬进 public 并把 src 换成相对路径——沿用 audioFile/bgmFile
      // 的分工。调用方传了 sourceVideoFile 却没在 input.sourceVideo 里带上
      // layout/pip 是调用点的 bug, 直接抛错而不是静默兜底成某种默认版式。
      if (!input.sourceVideo) {
        throw new Error(
          '[renderFilm] 传了 sourceVideoFile 但 input.sourceVideo 是 null——调用方必须同时给出 layout/pip。',
        );
      }
      const dest = copyIntoRenderAssets(opts.sourceVideoFile, opts.outputPath, 'video', renderAssetsDir);
      copiedAbsPaths.push(dest.absPath);
      input.sourceVideo = { ...input.sourceVideo, src: dest.relPath };
    }

    const serveUrl = bundleOutDir;
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
