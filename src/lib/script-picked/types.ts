export type Platform = 'douyin' | 'xiaohongshu' | 'gongzhonghao';

export interface PickedState {
  titleIdx?: number;       // 0-2
  hookIdx?: number;        // 0-2 (douyin only)
  reviewed: Record<string, boolean>;
}

export const REQUIRED_SECTIONS_BY_PLATFORM: Record<Platform, string[]> = {
  douyin: ['cover'],
  xiaohongshu: ['coverText', 'intro', 'body', 'tags', 'shotIdeas'],
  gongzhonghao: ['abstract', 'outline', 'body', 'cta'],
};

export const SECTION_LABELS: Record<string, string> = {
  cover: '封面方案',
  coverText: '封面大字',
  intro: '笔记开头',
  body: '正文',
  tags: '标签',
  shotIdeas: '配图建议',
  abstract: '摘要',
  outline: '大纲',
  cta: '文末互动',
};

export function emptyPicked(): PickedState {
  return { reviewed: {} };
}

export function isReady(platform: Platform, state: PickedState): boolean {
  if (state.titleIdx === undefined) return false;
  if (platform === 'douyin' && state.hookIdx === undefined) return false;
  const required = REQUIRED_SECTIONS_BY_PLATFORM[platform];
  for (const key of required) {
    if (!state.reviewed[key]) return false;
  }
  return true;
}

export function totalRequiredCount(platform: Platform): number {
  // titleIdx + (hookIdx if douyin) + each required section
  const base = 1 + REQUIRED_SECTIONS_BY_PLATFORM[platform].length;
  return platform === 'douyin' ? base + 1 : base;
}

export function checkedCount(platform: Platform, state: PickedState): number {
  let n = 0;
  if (state.titleIdx !== undefined) n++;
  if (platform === 'douyin' && state.hookIdx !== undefined) n++;
  for (const key of REQUIRED_SECTIONS_BY_PLATFORM[platform]) {
    if (state.reviewed[key]) n++;
  }
  return n;
}
