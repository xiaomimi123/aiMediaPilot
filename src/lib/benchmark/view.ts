import { AnalysisSchema, type Analysis } from './analyze';
import type { AccountRow, VideoQuery, VideoRow } from './store';

export interface VideoView {
  id: string;
  author: string;
  publishedAt: string;
  desc: string;
  url: string;
  digg: number;
  comment: number;
  collect: number;
  share: number;
  ratio: number | null;
  isHit: boolean;
  status: string;
  analysisStatus: 'none' | 'running' | 'done' | 'failed';
  analysisError: string | null;
  transcript: string | null;
  analysis: Analysis | null;
}

export interface AccountView {
  id: string;
  nickname: string;
  douyinId: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  baselineDigg: number | null;
  status: string;
  lastCheckedAt: string | null;
  lastHitAt: string | null;
}

/** 选题页列表: 只看爆款 / 全部(近 30 天 + 拆解过的老作品, 如粘链接进来的) */
export function listQuery(filter: 'hits' | 'all', now = new Date()): VideoQuery {
  return filter === 'hits'
    ? { isHit: true, statusNot: ['ignored'], take: 100 }
    : { statusNot: ['ignored'], publishedSince: new Date(now.getTime() - 30 * 86400_000), orAnalyzed: true, take: 100 };
}

export const STALE_MESSAGE = '拆解被服务重启打断了，点重试。';

/** 拆解一条约 1 分钟; 超过 15 分钟还是 running 且本进程队列里没有, 才算被重启打断(巡检脚本在另一个进程里拆的不算) */
export const STALE_AFTER_MS = 15 * 60_000;

export function staleRunning(v: VideoRow, active: boolean, now = new Date()): boolean {
  if (v.analysisStatus !== 'running' || active) return false;
  return !v.analysisStartedAt || now.getTime() - v.analysisStartedAt.getTime() > STALE_AFTER_MS;
}

export function toVideoView(v: VideoRow, author: string, active: boolean, now = new Date()): VideoView {
  const stale = staleRunning(v, active, now);
  const a = AnalysisSchema.safeParse(v.analysis);
  return {
    id: v.id,
    author,
    publishedAt: v.publishedAt.toISOString(),
    desc: v.desc,
    url: v.url,
    digg: v.digg,
    comment: v.comment,
    collect: v.collect,
    share: v.share,
    ratio: v.ratio,
    isHit: v.isHit,
    status: v.status,
    analysisStatus: stale ? 'failed' : (v.analysisStatus as VideoView['analysisStatus']),
    analysisError: stale ? STALE_MESSAGE : v.analysisError,
    transcript: v.transcript,
    analysis: a.success ? a.data : null,
  };
}

export function toAccountView(a: AccountRow, lastHitAt: Date | null): AccountView {
  return {
    id: a.id,
    nickname: a.nickname,
    douyinId: a.douyinId,
    avatarUrl: a.avatarUrl,
    bio: a.bio,
    followers: a.followers,
    baselineDigg: a.baselineDigg,
    status: a.status,
    lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
    lastHitAt: lastHitAt?.toISOString() ?? null,
  };
}
