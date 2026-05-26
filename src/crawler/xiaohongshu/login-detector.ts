import type { Page } from 'playwright-core';
import { XHS } from './selectors';

/**
 * 已登录判定:`.login-container` 模态被关闭就视为已登录。
 * 不能看 URL — 小红书是 SPA,扫码登录后 URL 经常仍是 /login,但模态会消失。
 */
export async function isXiaohongshuLoggedIn(page: Page): Promise<boolean> {
  return (await page.locator(XHS.LOGIN_CONTAINER).count()) === 0;
}

/**
 * 抓取登录页当前的二维码 base64 (含 data:image/png 前缀)
 * 二维码 src 会定期变化,worker 轮询调用
 */
export async function fetchXiaohongshuQrCode(page: Page): Promise<string | null> {
  try {
    await page.waitForSelector(XHS.QR_IMG, { timeout: 15000, state: 'attached' });
    return await page.locator(XHS.QR_IMG).first().getAttribute('src');
  } catch {
    return null;
  }
}

/** 从已登录用户的链接里解出 platformUid */
export async function extractXiaohongshuUid(page: Page): Promise<string | null> {
  const href = await page
    .locator(XHS.LOGGED_IN_USER_LINK)
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (!href) return null;
  const m = XHS.LOGGED_IN_PROFILE_HREF_REGEX.exec(href);
  return m ? m[1] : null;
}
