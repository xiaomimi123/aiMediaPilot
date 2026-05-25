import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { ProxyConfig } from '@/lib/proxy';
import { toPlaywrightProxy } from '@/lib/proxy';

const CDP_URL =
  process.env.CHROMIUM_REMOTE_DEBUG_URL || 'http://localhost:9222';

// CloakBrowser handles all fingerprint spoofing at the C++ binary level
// (58 source-level patches: UA, platform, navigator, webdriver flag, Canvas,
// WebGL, fonts, AudioContext, hardware concurrency, screen, GPU, etc.).
// No addInitScript spoofing needed or desired — it would conflict with
// CloakBrowser's internal state and degrade stealth quality.

let _shared: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_shared && _shared.isConnected()) return _shared;
  _shared = await chromium.connectOverCDP(CDP_URL);
  _shared.on('disconnected', () => (_shared = null));
  return _shared;
}

export interface ContextOpts {
  /** 容器内 userDataDir 路径,如 /profiles/<sessionId>。MVP 阶段共享 default profile,本字段保留为未来扩展位 */
  userDataDir?: string;
  proxy?: ProxyConfig | null;
}

export async function openContext(opts: ContextOpts = {}): Promise<BrowserContext> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    proxy: opts.proxy ? toPlaywrightProxy(opts.proxy) : undefined,
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  return ctx;
}

export async function closeAll() {
  if (_shared) {
    await _shared.close().catch(() => {});
    _shared = null;
  }
}
