import { NextRequest } from 'next/server';
import { chromium } from 'playwright-core';
import { ok, fail } from '@/lib/api';
import { toPlaywrightProxy, validateProxyShape, type ProxyConfig } from '@/lib/proxy';

const CDP_URL = process.env.CHROMIUM_REMOTE_DEBUG_URL || 'http://localhost:9222';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<ProxyConfig> | null;
  if (!body) return fail('请求体不合法');
  const err = validateProxyShape(body);
  if (err) return fail(err);

  const proxyConfig = body as ProxyConfig;
  const started = Date.now();
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = await browser.newContext({ proxy: toPlaywrightProxy(proxyConfig) });
    const page = await ctx.newPage();
    await page.goto('https://api.ipify.org?format=json', { timeout: 15_000 });
    const text = await page.locator('body').innerText();
    await ctx.close();
    const parsed = JSON.parse(text);
    return ok({
      ok: true,
      exitIp: parsed.ip as string,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    return fail(`代理连接失败: ${e instanceof Error ? e.message : String(e)}`, 400);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
