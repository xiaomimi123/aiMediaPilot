import fs from 'fs/promises';
import path from 'path';
import { measureFrameDensity, type FrameDensity } from '@/lib/video-production/frame-density';
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
}

/** 体检取样的宽高 —— 缩到很小不影响占比/分布统计, 但快得多(整帧 1920x1080 没必要)。 */
const PROBE_W = 160;
const PROBE_H = 90;
/** 在镜头中段等距取几帧: 避开开头入场、结尾退场这两段天然稀疏的时间。 */
const PROBE_POINTS = [0.35, 0.6, 0.85];

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
  const runtimeErrors: string[] = [];
  await fs.mkdir(workDir, { recursive: true });
  const indexHtmlPath = path.join(workDir, 'index.html');
  await fs.writeFile(indexHtmlPath, html, 'utf-8');
  await fs.copyFile(GSAP_ASSET_PATH, path.join(workDir, 'gsap.min.js'));

  let browser;
  try {
    browser = await chromium.launch({ executablePath: await findChromiumExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: PROBE_W, height: PROBE_H } });
    page.on('pageerror', (e) => runtimeErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') runtimeErrors.push(m.text()); });
    await page.goto(`file://${path.resolve(indexHtmlPath)}`);

    const samples: FrameDensity[] = [];
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
      if (!hasTimeline) return { samples: [], runtimeErrors };

      const png = await page.screenshot({ type: 'png' });
      const rgb = await page.evaluate(async (dataUrl) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const out: number[] = [];
        for (let i = 0; i < d.length; i += 4) { out.push(d[i], d[i + 1], d[i + 2]); }
        return { w: c.width, h: c.height, data: out };
      }, `data:image/png;base64,${png.toString('base64')}`);
      samples.push(measureFrameDensity(Buffer.from(rgb.data), rgb.w, rgb.h));
    }
    return { samples, runtimeErrors };
  } catch (e) {
    runtimeErrors.push(e instanceof Error ? e.message : String(e));
    return { samples: [], runtimeErrors };
  } finally {
    await browser?.close();
  }
}

/** 只要密度的薄封装 —— 保留给不关心运行时错误的调用方。 */
export async function probeShotDensity(opts: ProbeShotOpts): Promise<FrameDensity[]> {
  return (await probeShotHealth(opts)).samples;
}
