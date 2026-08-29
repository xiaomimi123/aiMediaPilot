import fs from 'fs/promises';
import path from 'path';
import { measureFrameDensity, type FrameDensity } from '@/lib/video-production/frame-density';
import { measureFrameDetail, type FrameDetail } from '@/lib/video-production/frame-detail';
import { measureFrameLayout, type FrameLayout } from '@/lib/video-production/frame-layout';
import os from 'os';
import { chromium } from 'playwright-core';
import { encodeFramesToClip } from '@/lib/video/ffmpeg';

const GSAP_ASSET_PATH = path.join(__dirname, 'assets', 'gsap.min.js');

export interface RenderShotOpts {
  html: string;
  durationMs: number;
  fps: number;
  workDir: string;
  outputClipPath: string;
  /** 成片画幅。不给则按老行为 1920x1080。 */
  frame?: { width: number; height: number };
}

/**
 * 找到本机可用的无头 Chromium 可执行文件路径。
 * 优先读 PLAYWRIGHT_CHROMIUM_PATH 环境变量；否则扫描
 * ~/Library/Caches/ms-playwright/ 下最新的 chromium-* 目录，
 * 在其中定位 Chromium 可执行文件。找不到则抛出明确错误。
 */
export async function findChromiumExecutable(): Promise<string> {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (envPath) {
    return envPath;
  }

  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  let entries: string[];
  try {
    entries = await fs.readdir(cacheDir);
  } catch {
    throw new Error(
      `找不到 Playwright Chromium 缓存目录: ${cacheDir}。请设置 PLAYWRIGHT_CHROMIUM_PATH 环境变量，或运行 playwright install chromium。`,
    );
  }

  const chromiumDirs = entries.filter((e) => e.startsWith('chromium-'));
  if (chromiumDirs.length === 0) {
    throw new Error(
      `${cacheDir} 下没有找到任何 chromium-* 目录。请设置 PLAYWRIGHT_CHROMIUM_PATH 环境变量，或运行 playwright install chromium。`,
    );
  }

  const withStats = await Promise.all(
    chromiumDirs.map(async (dir) => {
      const fullPath = path.join(cacheDir, dir);
      const stat = await fs.stat(fullPath);
      return { dir: fullPath, mtimeMs: stat.mtimeMs };
    }),
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latestDir = withStats[0].dir;

  const candidates = [
    path.join(latestDir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join(latestDir, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join(latestDir, 'chrome-linux', 'chrome'),
    path.join(latestDir, 'chrome-win', 'chrome.exe'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `在 ${latestDir} 下没有找到可用的 Chromium 可执行文件。请设置 PLAYWRIGHT_CHROMIUM_PATH 环境变量指向正确路径。`,
  );
}

export async function renderShotToClip(opts: RenderShotOpts): Promise<void> {
  const { html, durationMs, fps, workDir, outputClipPath } = opts;
  // 视口必须跟着成片画幅走。写死 1920x1080 会让竖屏成片里的 B-roll 只占 32% 高度,
  // 其余全是黑边 —— 真机上第一条真人出镜成片就是这么废掉的。
  const frame = opts.frame ?? { width: 1920, height: 1080 };

  const framesDir = path.join(workDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  const indexHtmlPath = path.join(workDir, 'index.html');
  await fs.writeFile(indexHtmlPath, html, 'utf-8');

  const gsapDestPath = path.join(workDir, 'gsap.min.js');
  await fs.copyFile(GSAP_ASSET_PATH, gsapDestPath);

  const executablePath = await findChromiumExecutable();

  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: frame.width, height: frame.height } });
    // `workDir`/`indexHtmlPath` 可能是相对路径 (productionRoot 默认 `./video-productions/<id>`,
    // 见 video-productions/route.ts) —— 直接拼进 file:// URL 会产出
    // `file://video-productions/...` 这种缺 host/根斜杠的非法 URL, Playwright 的
    // page.goto 会以 net::ERR_INVALID_URL 拒绝 (真实 E2E 走查触发, building 阶段每个
    // 镜头必现)。用 path.resolve 转成绝对路径后再拼 URL, 与 ffmpeg.ts concatClips
    // 里 `path.resolve(p)` 写 concat 列表的处理方式一致。
    // 页面内 JS 抛错时不捕获的话, 只能看到下面"__timelines['shot'] 不存在"这个**症状**,
    // 说不出根因 —— 真实排查踩过: 37 镜静态检查全过, 渲染照样失败, 查了半天才想到
    // 是脚本运行时抛错导致时间线没挂上。把页面错误收下来, 失败时一并报出。
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

    await page.goto(`file://${path.resolve(indexHtmlPath)}`);

    const totalFrames = Math.ceil((durationMs / 1000) * fps);
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      const sec = frameIndex / fps;
      await page.evaluate((s) => {
        const tl = (window as unknown as { __timelines?: Record<string, { seek: (s: number) => void }> }).__timelines?.[
          'shot'
        ];
        if (!tl) {
          throw new Error("window.__timelines['shot'] 不存在，无法 seek");
        }
        tl.seek(s);
      }, sec).catch((e: unknown) => {
        const detail = pageErrors.length ? ` 页面内报错: ${pageErrors.slice(0, 3).join(' | ')}` : ' 页面内无 JS 报错(时间线可能压根没写)';
        throw new Error(`${e instanceof Error ? e.message : String(e)}${detail}`);
      });

      const frameFileName = `frame_${String(frameIndex).padStart(4, '0')}.png`;
      await page.screenshot({ path: path.join(framesDir, frameFileName) });
    }
  } finally {
    await browser.close();
  }

  await encodeFramesToClip({ framesDir, fps, outputPath: outputClipPath });
}

export interface ProbeShotOpts {
  html: string;
  durationMs: number;
  workDir: string;
  /** 成片画幅。**必须和真实渲染一致**, 见 probeViewport。 */
  frame?: { width: number; height: number };
}

/**
 * 分析用的取样图长边。
 *
 * 171 不是随手取的: 2026-08-29 那次重标定, 所有基准点都是把帧缩到 96x171 量出来的
 * (真空屏 0.00% / 一行小字 0.11% / 标题卡 2.36% / 正常成片中位 4.7%)。改这个数就等于
 * 改了那套阈值的尺度, 要改必须连标定一起重做。
 */
const ANALYSIS_LONG = 171;

/** 等比缩到长边 ANALYSIS_LONG —— 竖屏得 96x171, 横屏得 171x96。 */
function analysisSize(w: number, h: number): { width: number; height: number } {
  return h > w
    ? { width: Math.max(1, Math.round((ANALYSIS_LONG * w) / h)), height: ANALYSIS_LONG }
    : { width: ANALYSIS_LONG, height: Math.max(1, Math.round((ANALYSIS_LONG * h) / w)) };
}

/**
 * 体检渲染的视口。
 *
 * **只跟着画幅换比例, 尺寸仍然缩到长边 160。** 原因是这个尺寸和 `frame-density.ts`
 * 里那条 0.03 阈值是一起标定出来的 —— 动了尺寸就等于动了那把尺, 而重新标定必须
 * 拿参考视频用同一套方法整个量一遍, 不是顺手能改的事。
 *
 * 踩过两次, 都记在这里以免重犯:
 *
 * 1. 一开始固定 160x90 **横屏**。成片改成竖屏后真实渲染是 1080x1920, 给竖屏排的版
 *    在横屏小窗里量, 量的根本不是同一个东西。(不过那次 23 秒纯空白镜头能过检的
 *    真正原因不在这 —— 真人出镜那条链压根没传 probeDir, 整关跳过了。)
 * 2. 试过改成按真实尺寸(1080x1920)渲染、分析时再缩。**量出来的数完全不是一个
 *    量级**: 同一份 HTML, 真实尺寸下 0.2%~0.4%, 缩小视口下 5.1%, 差 25 倍。
 *    既有的「一行小字标题页应当通过」那条测试当场挂掉 —— 那正是 0.03 阈值的锚。
 *    所以这条路要走, 得连标定一起重做, 不能只换渲染尺寸。
 */
export function probeViewport(frame?: { width: number; height: number }): { width: number; height: number } {
  if (!frame || frame.width <= 0 || frame.height <= 0) return { width: 1920, height: 1080 };
  return frame.height > frame.width
    ? { width: frame.width, height: frame.height }
    : { width: frame.width, height: frame.height };
}
/**
 * 在镜头中段等距取帧: 避开开头入场、结尾退场这两段天然稀疏的时间。
 *
 * **2026-08-30 从 3 点加到 6 点。** 3 个点对 20~40 秒的镜头太稀: 体检全过的一支成片,
 * 按 3 秒一帧扫全片仍有 21% 的帧「内容只排到画面 55% 以下」, 还有几帧下沿到了 94%~96%
 * 压在字幕上 —— 都在没被取样的时间里。判定是「多数帧不合格才拦」, 取样点少的时候
 * 这个「多数」代表不了观众真正看到的画面。
 *
 * 代价可控: 分析图已经缩到长边 171, 每个点只多一次截图 + 一次小图统计。
 */
const PROBE_POINTS = [0.2, 0.35, 0.5, 0.65, 0.8, 0.92];

/**
 * 只渲几帧来体检画面密度(二十一期), 不产出视频。
 *
 * 与 `renderShotToClip` 的关键差别: 那个要跑满 fps × 时长帧再编码, 一镜几十秒;
 * 这个只 seek 三个时间点各截一帧、缩到 160x90 量统计, 一镜一两秒。用于在正式渲染
 * **之前**判断 Builder 排的版是不是整屏空白, 空了就带着诊断让它重写。
 *
 * 任何异常(脚本坏掉、时间线没挂)都返回空数组而不是抛错 —— 那些属于语法/结构体检
 * 的职责, 在这里重复报错只会让失败原因互相掩盖。
 */
export interface ShotHealth {
  samples: FrameDensity[];
  /** 与 samples 一一对应的细节量 —— 用来分辨「大色块刷分」, 见 frame-detail.ts。 */
  details: FrameDetail[];
  /** 与 samples 一一对应的版面形状 —— 用来判「内容排到多低」, 见 frame-layout.ts。 */
  layouts: FrameLayout[];
  /** 与 samples 一一对应: 这一帧里有没有两块内容并排(读 DOM 真实几何)。 */
  sideBySide: boolean[];
  /** 页面内抛出的 JS 错误 —— 语法与结构体检都拦不住的运行时问题(如 GSAP 用法错误)。 */
  runtimeErrors: string[];
}

/**
 * 一次渲染同时体检两件事(二十一期): 画面密度 + 运行时错误。
 *
 * 真实出片踩过 `t.duration is not a function` —— 语法正确、时间线也挂上了, 但 GSAP
 * 调用方式不对, 两道静态体检全部放行, 直到正式渲染(几十镜跑完)才炸。而体检本来就
 * 在真跑页面, 顺手把错误收下来即可, 不额外花一次渲染。
 *
 * 任何异常都返回已收集到的结果而不是抛错 —— 判定交给调用方。
 */
export async function probeShotHealth(opts: ProbeShotOpts): Promise<ShotHealth> {
  const { html, durationMs, workDir } = opts;
  const probe = probeViewport(opts.frame);
  const runtimeErrors: string[] = [];
  await fs.mkdir(workDir, { recursive: true });
  const indexHtmlPath = path.join(workDir, 'index.html');
  await fs.writeFile(indexHtmlPath, html, 'utf-8');
  await fs.copyFile(GSAP_ASSET_PATH, path.join(workDir, 'gsap.min.js'));

  let browser;
  try {
    browser = await chromium.launch({ executablePath: await findChromiumExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: probe.width, height: probe.height } });
    page.on('pageerror', (e) => runtimeErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') runtimeErrors.push(m.text()); });
    await page.goto(`file://${path.resolve(indexHtmlPath)}`);

    const samples: FrameDensity[] = [];
    const details: FrameDetail[] = [];
    const layouts: FrameLayout[] = [];
    /** 每个取样点的 DOM 几何 —— 判「有没有两块内容并排」用, 见 frame-layout.ts。 */
    const sideBySide: boolean[] = [];
    for (const ratio of PROBE_POINTS) {
      const sec = (durationMs / 1000) * ratio;
      // 时间线不存在说明脚本压根没跑起来 —— 那是语法与结构体检的职责。这里放弃取样,
      // 否则会把"脚本坏了"误报成"画面太空", 两个失败原因互相掩盖。
      const hasTimeline = await page.evaluate((sv) => {
        const tl = (window as unknown as { __timelines?: Record<string, { seek: (s: number) => void }> }).__timelines?.['shot'];
        if (!tl) return false;
        tl.seek(sv);
        return true;
      }, sec).catch((e: unknown) => {
        runtimeErrors.push(e instanceof Error ? e.message : String(e));
        return false;
      });
      if (!hasTimeline) return { samples: [], details: [], layouts: [], sideBySide: [], runtimeErrors };

      const png = await page.screenshot({ type: 'png' });
      /*
       * **渲染按真实尺寸, 分析在缩图上做。** 两件事必须分开:
       * - 渲染尺寸决定排版对不对(缩小视口会让绝对定位的元素跑出可视区)
       * - 分析尺寸决定量出来的数, 阈值就是按 96/171 这个尺度标定的
       *
       * 一度让分析也在真实尺寸上做, 后果是逐像素读 200 万像素、拼成 600 万个数再
       * 序列化回 Node —— 20 分钟只渲完 1 个镜头, BullMQ 的任务锁直接续不上。
       */
      const small = analysisSize(probe.width, probe.height);
      const rgb = await page.evaluate(async ({ dataUrl, sw, sh }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, sw, sh);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const out: number[] = [];
        for (let i = 0; i < d.length; i += 4) { out.push(d[i], d[i + 1], d[i + 2]); }
        return { w: c.width, h: c.height, data: out };
      }, { dataUrl: `data:image/png;base64,${png.toString('base64')}`, sw: small.width, sh: small.height });
      const buf = Buffer.from(rgb.data);
      samples.push(measureFrameDensity(buf, rgb.w, rgb.h));
      details.push(measureFrameDetail(buf, rgb.w, rgb.h));
      layouts.push(measureFrameLayout(buf, rgb.w, rgb.h));

      /*
       * 并排检测读**真实 DOM 几何**, 不从像素里猜。
       *
       * 条件: 两个内容块竖直方向重叠过半、水平方向完全不重叠、而且各自都不到画面
       * 宽度的 60% —— 那就是并排。只看叶子节点(不含其它内容块的那些), 否则外层容器
       * 会和它自己的子元素配成一对。
       */
      const sbs = await page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const area = vw * vh;
        const blocks: { x: number; y: number; w: number; h: number }[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (r.width * r.height < area * 0.03) continue;            // 太小的不是内容块
          if (r.width > vw * 0.92 && r.height > vh * 0.92) continue; // 整屏容器
          blocks.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        }
        const leaves = blocks.filter((a) => !blocks.some((b) =>
          b !== a && b.x >= a.x - 1 && b.y >= a.y - 1 &&
          b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1));
        for (let i = 0; i < leaves.length; i++) {
          for (let j = i + 1; j < leaves.length; j++) {
            const a = leaves[i];
            const b = leaves[j];
            const v = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            const h = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            if (v > Math.min(a.h, b.h) * 0.6 && h <= 0 && a.w < vw * 0.6 && b.w < vw * 0.6) return true;
          }
        }
        return false;
      }).catch(() => false);
      sideBySide.push(sbs);
    }
    return { samples, details, layouts, sideBySide, runtimeErrors };
  } catch (e) {
    runtimeErrors.push(e instanceof Error ? e.message : String(e));
    return { samples: [], details: [], layouts: [], sideBySide: [], runtimeErrors };
  } finally {
    await browser?.close();
  }
}

/** 只要密度的薄封装 —— 保留给不关心运行时错误的调用方。 */
export async function probeShotDensity(opts: ProbeShotOpts): Promise<FrameDensity[]> {
  return (await probeShotHealth(opts)).samples;
}
