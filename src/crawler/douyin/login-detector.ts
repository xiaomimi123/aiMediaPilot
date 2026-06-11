import type { Page } from 'playwright-core';
import { DOUYIN } from './selectors';

/**
 * 抓登录页二维码 src (含 data:image 前缀)。
 * 抖音 QR 在登录弹层里的 img,src 是 base64,每隔一段时间会重置一次。
 */
export async function fetchDouyinQrCode(page: Page): Promise<string | null> {
  try {
    await page.waitForSelector(DOUYIN.QR_IMG, { timeout: 15000, state: 'attached' });
    const src = await page.locator(DOUYIN.QR_IMG).first().getAttribute('src');
    // 抖音可能给非 base64 的 URL,只取明显是 QR 的
    if (src && (src.startsWith('data:image') || /qr|qrcode/i.test(src))) return src;
    return src;
  } catch {
    return null;
  }
}

/** 从顶栏头像链接的 href 解出 sec_uid */
export async function extractDouyinUid(page: Page): Promise<string | null> {
  const links = page.locator(DOUYIN.LOGGED_IN_USER_LINK);
  const count = await links.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute('href').catch(() => null);
    if (!href) continue;
    const m = DOUYIN.LOGGED_IN_PROFILE_HREF_REGEX.exec(href);
    if (m) return m[1];
  }
  return null;
}
