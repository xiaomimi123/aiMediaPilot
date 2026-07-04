import type { Platform } from '@prisma/client';

/**
 * MediaPilot 有两套 "platform" 命名空间, 必须区分:
 *
 *  1. `Platform` (Prisma enum, 大写): 平台账号 / 采集端。 6 个值,
 *     PlatformAccount / PlatformNote / SyncTask 等表用它。
 *  2. `ContentPlatform` (小写): 内容创作端。 只覆盖当前支持的 3 个内容平台
 *     (抖音短视频 / 小红书图文 / 公众号长文), 对应 ScriptDraft.platform 字段。
 *
 * 之前散落在 5+ 处的字符串 union 和 inline guard, 现在统一从这里出。
 * `contentPlatformToPrisma` / `prismaToContentPlatform` 桥接两个世界。
 */

// ============ 采集端: Prisma Platform enum ============

export const PLATFORM_META: Record<
  Platform,
  {
    label: string;
    loginUrl: string;
    homeUrl: string;
  }
> = {
  XIAOHONGSHU: {
    label: '小红书',
    loginUrl: 'https://www.xiaohongshu.com/login',
    homeUrl: 'https://www.xiaohongshu.com',
  },
  DOUYIN: {
    label: '抖音',
    loginUrl: 'https://www.douyin.com',
    homeUrl: 'https://www.douyin.com',
  },
  WECHAT_MP: { label: '微信公众号', loginUrl: '', homeUrl: '' },
  BILIBILI: { label: 'B 站', loginUrl: '', homeUrl: '' },
  KUAISHOU: { label: '快手', loginUrl: '', homeUrl: '' },
  WEIBO: { label: '微博', loginUrl: '', homeUrl: '' },
};

// ============ 内容创作端: ContentPlatform ============

export type ContentPlatform = 'douyin' | 'xiaohongshu' | 'gongzhonghao';

export const CONTENT_PLATFORMS: readonly ContentPlatform[] = [
  'douyin',
  'xiaohongshu',
  'gongzhonghao',
] as const;

export const CONTENT_PLATFORM_LABEL: Record<ContentPlatform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  gongzhonghao: '公众号',
};

export const CONTENT_PLATFORM_EMOJI: Record<ContentPlatform, string> = {
  douyin: '🎬',
  xiaohongshu: '📕',
  gongzhonghao: '📰',
};

/** unknown → 类型窄化, API 边界统一用它, 别自己 inline 三段 or。 */
export function isContentPlatform(v: unknown): v is ContentPlatform {
  return v === 'douyin' || v === 'xiaohongshu' || v === 'gongzhonghao';
}

/** 内容创作端 → 采集端 (数据库 PlatformAccount / PlatformNote 用)。 */
export function contentPlatformToPrisma(cp: ContentPlatform): Platform {
  switch (cp) {
    case 'douyin':
      return 'DOUYIN';
    case 'xiaohongshu':
      return 'XIAOHONGSHU';
    case 'gongzhonghao':
      return 'WECHAT_MP';
  }
}

/** 采集端 → 内容创作端。 6 个 Prisma Platform 中只 3 个有对应 ContentPlatform, 其余 null。 */
export function prismaToContentPlatform(p: Platform): ContentPlatform | null {
  switch (p) {
    case 'DOUYIN':
      return 'douyin';
    case 'XIAOHONGSHU':
      return 'xiaohongshu';
    case 'WECHAT_MP':
      return 'gongzhonghao';
    default:
      return null;
  }
}
