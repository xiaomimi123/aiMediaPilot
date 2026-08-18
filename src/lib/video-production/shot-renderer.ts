import fs from 'fs/promises';
import path from 'path';
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

  const framesDir = path.join(workDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  const indexHtmlPath = path.join(workDir, 'index.html');
  await fs.writeFile(indexHtmlPath, html, 'utf-8');

  const gsapDestPath = path.join(workDir, 'gsap.min.js');
  await fs.copyFile(GSAP_ASSET_PATH, gsapDestPath);

  const executablePath = await findChromiumExecutable();

  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    // `workDir`/`indexHtmlPath` 可能是相对路径 (productionRoot 默认 `./video-productions/<id>`,
    // 见 video-productions/route.ts) —— 直接拼进 file:// URL 会产出
    // `file://video-productions/...` 这种缺 host/根斜杠的非法 URL, Playwright 的
    // page.goto 会以 net::ERR_INVALID_URL 拒绝 (真实 E2E 走查触发, building 阶段每个
    // 镜头必现)。用 path.resolve 转成绝对路径后再拼 URL, 与 ffmpeg.ts concatClips
    // 里 `path.resolve(p)` 写 concat 列表的处理方式一致。
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
      }, sec);

      const frameFileName = `frame_${String(frameIndex).padStart(4, '0')}.png`;
      await page.screenshot({ path: path.join(framesDir, frameFileName) });
    }
  } finally {
    await browser.close();
  }

  await encodeFramesToClip({ framesDir, fps, outputPath: outputClipPath });
}
