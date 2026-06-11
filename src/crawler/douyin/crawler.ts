import type { BrowserContext, Page } from 'playwright-core';
import type { ICrawler, NoteSummary, ProfileSnapshot } from '../base';
import { DOUYIN } from './selectors';
import { extractDouyinUid, fetchDouyinQrCode } from './login-detector';

export class DouyinSelectorMissingError extends Error {
  constructor(selector: string) {
    super(`Douyin selector not found: ${selector}`);
    this.name = 'DouyinSelectorMissingError';
  }
}

// 抖音数字格式: "1.2w" / "12万" / "1.5亿" / 普通整数
function parseDouyinCount(s: string): number {
  if (!s) return 0;
  const m = s.match(/([\d.]+)\s*(w|万|亿)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2] === '亿') return Math.round(n * 100_000_000);
  if (m[2] === 'w' || m[2] === '万') return Math.round(n * 10_000);
  return Math.round(n);
}

export const douyinCrawler: ICrawler = {
  async isLoginModalVisible(page: Page): Promise<boolean> {
    return (await page.locator(DOUYIN.LOGIN_CONTAINER).count().catch(() => 0)) > 0;
  },

  fetchQrCode: fetchDouyinQrCode,

  async scrapeProfile(ctx: BrowserContext): Promise<ProfileSnapshot> {
    const page = await ctx.newPage();
    await page.goto(DOUYIN.HOME_URL, { waitUntil: 'domcontentloaded' });
    const uid = await extractDouyinUid(page);
    if (!uid) throw new DouyinSelectorMissingError('user uid link');
    await page.goto(DOUYIN.PROFILE_URL(uid), { waitUntil: 'networkidle' });

    const text = async (sel: string): Promise<string> => {
      const t = await page.locator(sel).first().innerText().catch(() => '');
      return t.trim();
    };

    const nickname = await text(DOUYIN.PROFILE_NICKNAME);
    if (!nickname) throw new DouyinSelectorMissingError(DOUYIN.PROFILE_NICKNAME);
    const avatar =
      (await page.locator(DOUYIN.PROFILE_AVATAR).first().getAttribute('src').catch(() => null)) ??
      undefined;
    const bio = (await text(DOUYIN.PROFILE_BIO)) || undefined;
    const followerCount = parseDouyinCount(await text(DOUYIN.PROFILE_FOLLOWER_COUNT));
    const followingCount = parseDouyinCount(await text(DOUYIN.PROFILE_FOLLOWING_COUNT));
    const likeCount = parseDouyinCount(await text(DOUYIN.PROFILE_LIKE_COUNT));
    // 抖音主页头部不直接显示作品数,作品 tab 里的总数也是动态加载;
    // MVP 用视频卡片 count 充当 noteCount,等真账号验收时按 dump 调。
    const noteCount = await page.locator(DOUYIN.VIDEO_CARD).count().catch(() => 0);

    await page.close();
    return {
      platformUid: uid,
      nickname,
      avatar,
      bio,
      followerCount,
      followingCount,
      noteCount,
      likeCount,
    };
  },

  async scrapeNotes(ctx: BrowserContext, limit: number): Promise<NoteSummary[]> {
    const page = await ctx.newPage();
    await page.goto(DOUYIN.HOME_URL, { waitUntil: 'domcontentloaded' });
    const uid = await extractDouyinUid(page);
    if (!uid) throw new DouyinSelectorMissingError('user uid link');
    await page.goto(DOUYIN.PROFILE_URL(uid), { waitUntil: 'networkidle' });

    let stale = 0;
    let prevCount = 0;
    while (stale < 3) {
      const count = await page.locator(DOUYIN.VIDEO_CARD).count();
      if (count >= limit) break;
      if (count === prevCount) stale++;
      else {
        stale = 0;
        prevCount = count;
      }
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(800);
    }

    const cards = await page.locator(DOUYIN.VIDEO_CARD).all();
    const results: NoteSummary[] = [];
    for (const card of cards.slice(0, limit)) {
      const href = await card.locator(DOUYIN.VIDEO_LINK).first().getAttribute('href').catch(() => null);
      const title = (await card.locator(DOUYIN.VIDEO_TITLE).first().innerText().catch(() => '')).trim();
      const likeText = (await card.locator(DOUYIN.VIDEO_LIKE_COUNT).first().innerText().catch(() => '0')).trim();
      const cover = (await card.locator(DOUYIN.VIDEO_COVER).first().getAttribute('src').catch(() => null)) ?? undefined;
      const m = href?.match(/\/video\/(\d+)/);
      if (!m) continue;

      results.push({
        platformNoteId: m[1],
        title,
        type: 'VIDEO',
        coverUrl: cover ?? undefined,
        tags: [],
        likeCount: parseDouyinCount(likeText),
        commentCount: 0,
        shareCount: 0,
        viewCount: 0,
        collectCount: 0,
        sourceUrl: href ? (href.startsWith('http') ? href : `https://www.douyin.com${href}`) : undefined,
      });
    }
    await page.close();
    return results;
  },
};
