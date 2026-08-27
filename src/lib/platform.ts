/**
 * 内容创作端的平台命名空间。
 *
 * 阶段 2 之前这里还有一套「采集端」命名空间(Prisma 的 `Platform` enum、
 * PLATFORM_META、以及两个方向的桥接函数), 服务于 PlatformAccount /
 * PlatformNote / SyncTask 那批表。那批表连同 enum 已在数据模型清理中删除,
 * 三个导出确认零引用, 一并摘掉 —— 现在只剩一套 platform, 不用再区分。
 */

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

/** unknown → 类型窄化, API 边界统一用它, 别自己 inline 三段 or。 */
export function isContentPlatform(v: unknown): v is ContentPlatform {
  return v === 'douyin' || v === 'xiaohongshu' || v === 'gongzhonghao';
}


