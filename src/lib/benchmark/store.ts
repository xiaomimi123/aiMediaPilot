import type { Prisma, PrismaClient } from '@prisma/client';
import type { ParsedProfile, ParsedWork } from './parse';

export interface AccountRow {
  id: string;
  secUid: string;
  nickname: string;
  douyinId: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  totalLikes: number;
  status: string;
  source: string;
  searchKeyword: string | null;
  baselineDigg: number | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
}

export interface VideoRow {
  id: string;
  awemeId: string;
  accountId: string;
  desc: string;
  url: string;
  publishedAt: Date;
  durationSec: number;
  digg: number;
  comment: number;
  collect: number;
  share: number;
  ratio: number | null;
  isHit: boolean;
  hitAt: Date | null;
  status: string;
  analysisStatus: string;
  analysisError: string | null;
  transcript: string | null;
  analysis: unknown;
  analyzedAt: Date | null;
  fetchedAt: Date;
}

export interface VideoQuery {
  accountId?: string;
  isHit?: boolean;
  statusNot?: string[];
  publishedSince?: Date;
  hitSince?: Date;
  analysisStatus?: string;
  /** 与 publishedSince 连用: 发布早于窗口但拆解过/在拆的作品也算(粘链接进来的老视频) */
  orAnalyzed?: boolean;
  take?: number;
}

export interface BenchmarkStore {
  listAccounts(status?: string): Promise<AccountRow[]>;
  getAccount(id: string): Promise<AccountRow | null>;
  /** 已存在的账号只更新资料, 不改 status/source(不把"关注中"降级为"候选") */
  upsertAccount(p: ParsedProfile, init: { status: string; source: string; searchKeyword?: string }): Promise<AccountRow>;
  updateAccount(id: string, data: Partial<Pick<AccountRow, 'status' | 'baselineDigg' | 'lastCheckedAt'>>): Promise<void>;
  upsertVideo(accountId: string, w: ParsedWork, fetchedAt: Date): Promise<VideoRow>;
  /** publishedAt 降序 */
  listVideos(q: VideoQuery): Promise<VideoRow[]>;
  getVideo(id: string): Promise<VideoRow | null>;
  updateVideo(id: string, data: Partial<Omit<VideoRow, 'id' | 'awemeId' | 'accountId'>>): Promise<void>;
}

const profileData = (p: ParsedProfile) => ({
  nickname: p.nickname,
  douyinId: p.douyinId,
  avatarUrl: p.avatarUrl,
  bio: p.bio,
  followers: p.followers,
  totalLikes: p.totalLikes,
});

const statsData = (w: ParsedWork) => ({ desc: w.desc, url: w.url, durationSec: w.durationSec, digg: w.digg, comment: w.comment, collect: w.collect, share: w.share });

export function createPrismaStore(db: PrismaClient): BenchmarkStore {
  return {
    listAccounts: (status) => db.benchmarkAccount.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'asc' } }),
    getAccount: (id) => db.benchmarkAccount.findUnique({ where: { id } }),
    upsertAccount: (p, init) =>
      db.benchmarkAccount.upsert({
        where: { secUid: p.secUid },
        update: profileData(p),
        create: { secUid: p.secUid, ...profileData(p), status: init.status, source: init.source, searchKeyword: init.searchKeyword ?? null },
      }),
    updateAccount: async (id, data) => {
      await db.benchmarkAccount.update({ where: { id }, data });
    },
    upsertVideo: (accountId, w, fetchedAt) =>
      db.benchmarkVideo.upsert({
        where: { awemeId: w.awemeId },
        update: { ...statsData(w), fetchedAt },
        create: { awemeId: w.awemeId, accountId, publishedAt: w.publishedAt, fetchedAt, ...statsData(w) },
      }),
    listVideos: (q) =>
      db.benchmarkVideo.findMany({
        where: {
          accountId: q.accountId,
          isHit: q.isHit,
          status: q.statusNot ? { notIn: q.statusNot } : undefined,
          ...(q.publishedSince
            ? q.orAnalyzed
              ? { OR: [{ publishedAt: { gte: q.publishedSince } }, { analysisStatus: { not: 'none' } }] }
              : { publishedAt: { gte: q.publishedSince } }
            : {}),
          hitAt: q.hitSince ? { gte: q.hitSince } : undefined,
          analysisStatus: q.analysisStatus,
        },
        orderBy: { publishedAt: 'desc' },
        take: q.take,
      }),
    getVideo: (id) => db.benchmarkVideo.findUnique({ where: { id } }),
    updateVideo: async (id, data) => {
      await db.benchmarkVideo.update({ where: { id }, data: { ...data, analysis: data.analysis as Prisma.InputJsonValue | undefined } });
    },
  };
}
