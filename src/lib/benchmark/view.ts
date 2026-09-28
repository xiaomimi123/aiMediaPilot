import { AnalysisSchema, type Analysis } from './analyze';
import type { AccountRow, VideoRow } from './store';

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

export const STALE_MESSAGE = '拆解被服务重启打断了，点重试。';

export function staleRunning(v: VideoRow, active: boolean): boolean {
  return v.analysisStatus === 'running' && !active;
}

export function toVideoView(v: VideoRow, author: string, active: boolean): VideoView {
  const stale = staleRunning(v, active);
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
