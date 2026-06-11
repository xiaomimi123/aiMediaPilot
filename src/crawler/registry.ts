import type { Platform } from '@prisma/client';
import type { ICrawler } from './base';
import { xiaohongshuCrawler } from './xiaohongshu/crawler';
import { douyinCrawler } from './douyin/crawler';

/** Platform → crawler。null 表示当前 Phase 还未实现该平台。 */
export const CRAWLERS: Record<Platform, ICrawler | null> = {
  XIAOHONGSHU: xiaohongshuCrawler,
  DOUYIN: douyinCrawler,
  WECHAT_MP: null,
  BILIBILI: null,
  KUAISHOU: null,
  WEIBO: null,
};

export function getCrawler(platform: Platform): ICrawler {
  const c = CRAWLERS[platform];
  if (!c) throw new Error(`No crawler implemented for platform ${platform}`);
  return c;
}
