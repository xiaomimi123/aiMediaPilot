export type Platform = 'douyin' | 'xiaohongshu' | 'gongzhonghao';
export type PlatformFilter = 'all' | Platform;

export const PLATFORM_LABEL: Record<Platform, string> = {
  douyin: '🎬 抖音',
  xiaohongshu: '📕 小红书',
  gongzhonghao: '📰 公众号',
};

export interface VideoItem {
  id: string;
  platform: Platform;
  awemeId: string;
  videoUrl: string;
  authorName: string | null;
  title: string;
  playCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  shareCount: string | null;
  duration: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  userNote: string | null;
  fetchedAt: string;
}

export interface InsightOutput {
  titlePatterns: string[];
  hookTypes: string[];
  durationInsight: string;
  topicClusters: string[];
  recommendedTopics: { title: string; rationale: string }[];
  summary: string;
}

export interface InsightHistoryItem {
  id: string;
  videoIds: string[];
  output: InsightOutput;
  generatedAt: string;
}

export function formatPlays(s: string | null): string {
  if (!s) return '—';
  const n = Number(s);
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function detectClientPlatform(input: string): {
  platform: Platform | null;
  isShortLink: boolean;
} {
  const t = input.trim();
  if (!t) return { platform: null, isShortLink: false };
  if (/douyin\.com|iesdouyin\.com/.test(t)) {
    return { platform: 'douyin', isShortLink: /v\.douyin\.com/.test(t) };
  }
  if (/xiaohongshu\.com|xhslink\.com/.test(t)) {
    return { platform: 'xiaohongshu', isShortLink: /xhslink\.com/.test(t) };
  }
  if (/mp\.weixin\.qq\.com/.test(t)) return { platform: 'gongzhonghao', isShortLink: false };
  if (/^\d{15,25}$/.test(t)) return { platform: 'douyin', isShortLink: false };
  return { platform: null, isShortLink: false };
}
