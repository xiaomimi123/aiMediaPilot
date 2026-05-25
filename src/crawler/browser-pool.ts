import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { ProxyConfig } from '@/lib/proxy';
import { toPlaywrightProxy } from '@/lib/proxy';

const CDP_URL =
  process.env.CHROMIUM_REMOTE_DEBUG_URL || 'http://localhost:9222';

// 容器内是 Linux Chromium。小红书风控对 Linux 桌面用户高度敏感,需要把
// User-Agent / sec-ch-ua-platform / navigator.* 全部伪装成 macOS Chrome。
const FAKE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const FAKE_PLATFORM = 'macOS';
const FAKE_PLATFORM_VERSION = '14.3.0';
const CHROME_VERSION = '148';
const CHROME_FULL_VERSION = '148.0.7778.178';

// **必须**用字符串形式而非函数形式注入。tsx/esbuild 会给命名函数包 __name()
// 帮 stack trace,但 __name 在浏览器里不存在,函数序列化后跑就 ReferenceError
// 静默挂掉,所有 spoof 失效。字符串内容 tsx 不动,跑起来 100% 还原。
const INIT_SCRIPT = `
(function () {
  var FAKE_PLATFORM = ${JSON.stringify(FAKE_PLATFORM)};
  var FAKE_PLATFORM_VERSION = ${JSON.stringify(FAKE_PLATFORM_VERSION)};
  var CHROME_VERSION = ${JSON.stringify(CHROME_VERSION)};
  var CHROME_FULL_VERSION = ${JSON.stringify(CHROME_FULL_VERSION)};

  var Nav = Object.getPrototypeOf(navigator);
  function def(key, value) {
    try {
      Object.defineProperty(Nav, key, { get: function () { return value; }, configurable: true });
    } catch (e) {
      try {
        Object.defineProperty(navigator, key, { get: function () { return value; }, configurable: true });
      } catch (e2) {}
    }
  }

  def('platform', 'MacIntel');
  def('vendor', 'Google Inc.');
  def('webdriver', false);

  var brands = [
    { brand: 'Google Chrome', version: CHROME_VERSION },
    { brand: 'Chromium', version: CHROME_VERSION },
    { brand: 'Not=A?Brand', version: '24' }
  ];
  var fullVersionList = [
    { brand: 'Google Chrome', version: CHROME_FULL_VERSION },
    { brand: 'Chromium', version: CHROME_FULL_VERSION },
    { brand: 'Not=A?Brand', version: '24.0.0.0' }
  ];
  var fakeUAD = {
    brands: brands,
    mobile: false,
    platform: FAKE_PLATFORM,
    getHighEntropyValues: function () {
      return Promise.resolve({
        architecture: 'x86',
        bitness: '64',
        brands: brands,
        mobile: false,
        model: '',
        platform: FAKE_PLATFORM,
        platformVersion: FAKE_PLATFORM_VERSION,
        uaFullVersion: CHROME_FULL_VERSION,
        fullVersionList: fullVersionList
      });
    },
    toJSON: function () {
      return { brands: brands, mobile: false, platform: FAKE_PLATFORM };
    }
  };
  def('userAgentData', fakeUAD);
})();
`;

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
    userAgent: FAKE_UA,
    extraHTTPHeaders: {
      'sec-ch-ua': `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not=A?Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': `"${FAKE_PLATFORM}"`,
    },
  });

  await ctx.addInitScript(INIT_SCRIPT);
  return ctx;
}

export async function closeAll() {
  if (_shared) {
    await _shared.close().catch(() => {});
    _shared = null;
  }
}
