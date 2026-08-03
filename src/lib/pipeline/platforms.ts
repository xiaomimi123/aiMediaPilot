/**
 * 分发登记平台注册表 (spec §2.4)。加新平台 = 加一行, 不改 DB。
 * 与 src/lib/platform.ts 的两套命名空间独立:
 * 这里是"内容搬运到了哪", 不是采集端 Platform enum, 也不是创作端 ContentPlatform。
 */
export interface DistributionPlatformMeta {
  key: string;
  label: string;
  badgeClass: string;
}

export const DISTRIBUTION_PLATFORMS: readonly DistributionPlatformMeta[] = [
  { key: 'douyin', label: '抖音', badgeClass: 'bg-slate-900 text-white' },
  { key: 'bilibili', label: 'B站', badgeClass: 'bg-sky-100 text-sky-900' },
  { key: 'youtube', label: 'YouTube', badgeClass: 'bg-red-100 text-red-900' },
  { key: 'twitter', label: 'X/推特', badgeClass: 'bg-neutral-200 text-neutral-900' },
  { key: 'xiaohongshu', label: '小红书', badgeClass: 'bg-rose-100 text-rose-900' },
  { key: 'gongzhonghao', label: '公众号', badgeClass: 'bg-emerald-100 text-emerald-900' },
  { key: 'kuaishou', label: '快手', badgeClass: 'bg-orange-100 text-orange-900' },
  { key: 'weibo', label: '微博', badgeClass: 'bg-amber-100 text-amber-900' },
];

export function distributionPlatformMeta(key: string): DistributionPlatformMeta {
  return (
    DISTRIBUTION_PLATFORMS.find((p) => p.key === key) ?? {
      key,
      label: key,
      badgeClass: 'bg-muted text-muted-foreground',
    }
  );
}
