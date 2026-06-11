import type { BrowserContext, Page } from 'playwright-core';
import type { ICrawler, NoteSummary, ProfileSnapshot } from '../base';
import { XHS } from './selectors';
import { extractXiaohongshuUid, fetchXiaohongshuQrCode } from './login-detector';

export class SelectorMissingError extends Error {
  constructor(selector: string) {
    super(`Selector not found: ${selector}`);
    this.name = 'SelectorMissingError';
  }
}

export const xiaohongshuCrawler: ICrawler = {
  async isLoginModalVisible(page: Page): Promise<boolean> {
    return (await page.locator(XHS.LOGIN_CONTAINER).count().catch(() => 0)) > 0;
  },
  fetchQrCode: fetchXiaohongshuQrCode,

  async scrapeProfile(ctx: BrowserContext): Promise<ProfileSnapshot> {
    const page = await ctx.newPage();
    await page.goto(XHS.HOME_URL, { waitUntil: 'domcontentloaded' });
    const uid = await extractXiaohongshuUid(page);
    if (!uid) throw new SelectorMissingError('user uid link');
    await page.goto(XHS.PROFILE_URL(uid), { waitUntil: 'networkidle' });

    const text = async (sel: string): Promise<string> => {
      const t = await page.locator(sel).first().innerText().catch(() => '');
      return t.trim();
    };
    const num = (s: string): number => {
      const m = s.match(/([\d.]+)\s*(w|万)?/);
      if (!m) return 0;
      const n = parseFloat(m[1]);
      return m[2] ? Math.round(n * 10_000) : Math.round(n);
    };

    const nickname = await text(XHS.PROFILE_NICKNAME);
    if (!nickname) throw new SelectorMissingError(XHS.PROFILE_NICKNAME);
    const avatar = await page.locator(XHS.PROFILE_AVATAR).first().getAttribute('src') ?? undefined;
    const bio = (await text(XHS.PROFILE_BIO)) || undefined;
    const followerCount = num(await text(XHS.PROFILE_FOLLOWER_COUNT));
    const followingCount = num(await text(XHS.PROFILE_FOLLOWING_COUNT));
    const noteCount = num(await text(XHS.PROFILE_NOTE_COUNT));
    const likeCount = num(await text(XHS.PROFILE_LIKE_COUNT));

    await page.close();
    return { platformUid: uid, nickname, avatar, bio, followerCount, followingCount, noteCount, likeCount };
  },

  async scrapeNotes(ctx: BrowserContext, limit: number): Promise<NoteSummary[]> {
    const page = await ctx.newPage();
    await page.goto(XHS.HOME_URL, { waitUntil: 'domcontentloaded' });
    const uid = await extractXiaohongshuUid(page);
    if (!uid) throw new SelectorMissingError('user uid link');
    await page.goto(XHS.PROFILE_URL(uid), { waitUntil: 'networkidle' });

    let stale = 0;
    let prevCount = 0;
    while (stale < 3) {
      const count = await page.locator(XHS.NOTE_CARD).count();
      if (count >= limit) break;
      if (count === prevCount) stale++;
      else { stale = 0; prevCount = count; }
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(800);
    }

    const cards = await page.locator(XHS.NOTE_CARD).all();
    const results: NoteSummary[] = [];
    for (const card of cards.slice(0, limit)) {
      const href = await card.locator(XHS.NOTE_LINK).getAttribute('href').catch(() => null);
      const title = (await card.locator(XHS.NOTE_TITLE).innerText().catch(() => '')).trim();
      const likeText = (await card.locator(XHS.NOTE_LIKE_COUNT).innerText().catch(() => '0')).trim();
      const cover = await card.locator(XHS.NOTE_COVER).getAttribute('src').catch(() => undefined);
      const m = href?.match(/\/explore\/([a-f0-9]+)/);
      if (!m) continue;

      results.push({
        platformNoteId: m[1],
        title,
        type: cover?.includes('video') ? 'VIDEO' : 'IMAGE_TEXT',
        coverUrl: cover ?? undefined,
        tags: [],
        likeCount: parseInt(likeText.replace(/[^\d]/g, ''), 10) || 0,
        commentCount: 0,
        shareCount: 0,
        viewCount: 0,
        collectCount: 0,
        sourceUrl: href ? `https://www.xiaohongshu.com${href}` : undefined,
      });
    }
    await page.close();
    return results;
  },
};
