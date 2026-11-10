import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { probeVideoDimensions } from '@/lib/video/ffmpeg';

const p = promisify(execFile);

/**
 * 演示录屏: 无头 Chromium 打开演示页(或官网), 做一段匀速滚动 + 轻缩放的动画,
 * 屏幕录制成 webm 再由 ffmpeg 转码成 H.264 横版 mp4, 当作品素材(kind='material')。
 *
 * Playwright 用 npx 缓存里的 1.61.1(与 ~/Library/Caches/ms-playwright 已装的
 * chromium-1228 配套, 2026-11-10 真机验证出图正常); 不加进 package.json,
 * 避免装一套新浏览器。找 playwright 的顺序: DEMO_PLAYWRIGHT_PATH 环境变量 → npx 缓存。
 */

const NPX_CACHE_CANDIDATES = [
  process.env.DEMO_PLAYWRIGHT_PATH,
  '/Users/lizhishaoniange/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs',
].filter(Boolean) as string[];

async function loadPlaywright(): Promise<{ chromium: { launch(o?: object): Promise<any> } }> {
  for (const candidate of NPX_CACHE_CANDIDATES) {
    // webpackIgnore: Next 会改写动态 import 导致绝对路径解析失败, 这里强制走原生 ESM
    const mod = await import(/* webpackIgnore: true */ candidate).catch(() => null);
    if (mod) return mod;
  }
  throw new Error('没找到 Playwright（npx 缓存被清了就设 DEMO_PLAYWRIGHT_PATH 指到 playwright/index.mjs）');
}

export interface DemoVideoOpts {
  /** 要录的页面: 本地演示页 file:// 或官网 https:// */
  url: string;
  outFile: string;
  /** 目标时长(秒), 约 8~20 */
  seconds: number;
  width?: number;
  height?: number;
}

export interface DemoVideoResult {
  file: string;
  width: number;
  height: number;
  durationSec: number;
}

/** 对一个页面截单张 PNG(封面用; 与录屏同一套 Playwright 加载逻辑) */
export async function screenshotPage(opts: { url: string; outFile: string; width?: number; height?: number }): Promise<void> {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  try {
    const page = await browser.newPage({ viewport: { width: opts.width ?? 1080, height: opts.height ?? 1440 } });
    await page.goto(opts.url, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForTimeout(800); // 字体/图片落地
    await page.screenshot({ path: opts.outFile });
  } finally {
    await browser.close().catch(() => null);
  }
}

/** 录一段演示动画并转码成横版 mp4。失败抛错(人话)。 */
export async function recordDemoVideo(opts: DemoVideoOpts): Promise<DemoVideoResult> {
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const seconds = Math.min(Math.max(opts.seconds, 6), 20);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const rawMp4 = `${opts.outFile}.raw.mp4`;
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(opts.url, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForTimeout(1500);
    // 匀速慢滚 + 1.0→1.06 的极缓放大, 动画时长 = 目标时长
    // 用字符串表达式(不传函数): tsx 的 esbuild 转换会给函数注入 __name, 浏览器里未定义直接报错
    // 额外叠一层时间驱动的微缩放: 页面滚到头/内容静止时浏览器不出新帧, 微动保证 screencast 持续出帧
    const dur = seconds;
    await page.evaluate(`(() => {
      const dur = ${dur};
      const style = document.createElement('style');
      style.textContent = 'html { scroll-behavior: auto !important; }';
      document.head.appendChild(style);
      document.documentElement.style.background = getComputedStyle(document.body).backgroundColor || '#000';
      const start = performance.now();
      const step = (t) => {
        const k = Math.min((t - start) / (dur * 1000), 1);
        const ease = k * (2 - k);
        window.scrollTo(0, ease * Math.max(document.body.scrollHeight - innerHeight, 0) * 0.8);
        const breath = 1 + 0.06 * ease + 0.0012 * Math.sin(t / 90);
        document.body.style.transformOrigin = '50% 30%';
        document.body.style.transform = 'scale(' + breath + ')';
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    })()`);
    // CDP screencast 录制: 页面动画跑的同时录
    const cdp = await page.context().newCDPSession(page);
    const frames: { data: string }[] = [];
    cdp.on('Page.screencastFrame', (ev: { data: string; sessionId: number }) => {
      // ack 必须回事件的 sessionId, 不回浏览器停止推帧(真机踩过: 传 timestamp 只出到 1 帧)
      void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => null);
      frames.push({ data: ev.data });
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.waitForTimeout(dur * 1000);
    await cdp.send('Page.stopScreencast');
    await browser.close();

    if (frames.length < 5) throw new Error('录屏几乎没录到帧，重试一次');
    // screencast 出帧率不定(真机 8 秒录到 789 帧), 按 30fps 目标均匀抽帧, 否则成片变慢放
    const target = seconds * 30;
    const picked = frames.length <= target ? frames : frames.filter((_, i) => Math.floor((i * target) / frames.length) !== Math.floor(((i + 1) * target) / frames.length));
    // 帧写 png 序列, 交给 ffmpeg 拼视频
    const tmpDir = `${opts.outFile}.frames`;
    await fs.mkdir(tmpDir, { recursive: true });
    let i = 0;
    for (const f of picked) {
      await fs.writeFile(path.join(tmpDir, `${String(i).padStart(5, '0')}.png`), Buffer.from(f.data, 'base64'));
      i++;
    }
    await p('ffmpeg', ['-y', '-framerate', '30', '-i', path.join(tmpDir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', rawMp4], { timeout: 120_000 });
    await fs.rm(tmpDir, { recursive: true, force: true });

    const dim = await probeVideoDimensions(rawMp4);
    await fs.rename(rawMp4, opts.outFile);
    return { file: opts.outFile, width: dim.width, height: dim.height, durationSec: seconds };
  } catch (e) {
    await browser.close().catch(() => null);
    await fs.rm(rawMp4, { force: true }).catch(() => null);
    throw e instanceof Error ? e : new Error(String(e));
  }
}
