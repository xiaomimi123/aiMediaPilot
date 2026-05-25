import type { Page } from 'playwright-core';
import { XHS } from './selectors';

/**
 * 已登录判定:URL 为非 /login 且能找到用户头像链接(href 含 /user/profile/{uid})
 */
export async function isXiaohongshuLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/login') || url.includes('xiaohongshu.com/explore')) return false;
  try {
    await page.waitForSelector(XHS.LOGGED_IN_USER_LINK, { timeout: 3_000, state: 'attached' });
    const href = await page.locator(XHS.LOGGED_IN_USER_LINK).first().getAttribute('href');
    return !!(href && XHS.LOGGED_IN_PROFILE_HREF_REGEX.test(href));
  } catch {
    return false;
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
