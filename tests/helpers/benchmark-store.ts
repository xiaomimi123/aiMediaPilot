import type { AccountRow, BenchmarkStore, VideoRow } from '@/lib/benchmark/store';

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

export function createMemoryStore(): BenchmarkStore & { accounts: AccountRow[]; videos: VideoRow[] } {
  const accounts: AccountRow[] = [];
  const videos: VideoRow[] = [];
  return {
    accounts,
    videos,
    listAccounts: async (status) => accounts.filter((a) => !status || a.status === status).map((a) => ({ ...a })),
    getAccount: async (id) => accounts.find((a) => a.id === id) ?? null,
    upsertAccount: async (p, init) => {
      const hit = accounts.find((a) => a.secUid === p.secUid);
      const profile = { nickname: p.nickname, douyinId: p.douyinId, avatarUrl: p.avatarUrl, bio: p.bio, followers: p.followers, totalLikes: p.totalLikes };
      if (hit) return Object.assign(hit, profile);
      const row: AccountRow = { id: nextId('a'), secUid: p.secUid, ...profile, status: init.status, source: init.source, searchKeyword: init.searchKeyword ?? null, baselineDigg: null, lastCheckedAt: null, createdAt: new Date() };
      accounts.push(row);
      return row;
    },
    updateAccount: async (id, data) => {
      Object.assign(accounts.find((a) => a.id === id)!, data);
    },
    upsertVideo: async (accountId, w, fetchedAt) => {
      const stats = { desc: w.desc, url: w.url, durationSec: w.durationSec, digg: w.digg, comment: w.comment, collect: w.collect, share: w.share, fetchedAt };
      const hit = videos.find((v) => v.awemeId === w.awemeId);
      if (hit) return Object.assign(hit, stats);
      const row: VideoRow = {
        id: nextId('v'), awemeId: w.awemeId, accountId, publishedAt: w.publishedAt, ...stats, ratio: null, isHit: false, hitAt: null,
        status: 'new', analysisStatus: 'none', analysisError: null, transcript: null, analysis: null, analyzedAt: null,
      };
      videos.push(row);
      return row;
    },
    listVideos: async (q) =>
      videos
        .filter(
          (v) =>
            (!q.accountId || v.accountId === q.accountId) &&
            (q.isHit === undefined || v.isHit === q.isHit) &&
            (!q.statusNot || !q.statusNot.includes(v.status)) &&
            (!q.publishedSince || v.publishedAt >= q.publishedSince) &&
            (!q.hitSince || (v.hitAt !== null && v.hitAt >= q.hitSince)) &&
            (!q.analysisStatus || v.analysisStatus === q.analysisStatus),
        )
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, q.take ?? Infinity)
        .map((v) => ({ ...v })), // 与 Prisma 一致: 返回副本, 不是库里的对象本身
    getVideo: async (id) => {
      const v = videos.find((x) => x.id === id);
      return v ? { ...v } : null;
    },
    updateVideo: async (id, data) => {
      Object.assign(videos.find((v) => v.id === id)!, data);
    },
  };
}
