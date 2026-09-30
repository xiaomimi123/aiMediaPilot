import type { LinkTarget } from './link';
import { DouyinRejectedError } from './parse';
import type { DouyinClient } from './douyin';
import type { BenchmarkStore } from './store';
import { applyAccountWorks } from './scan';

export interface PasteDeps {
  store: BenchmarkStore;
  client: Pick<DouyinClient, 'fetchAccount' | 'fetchDetail'>;
  /** 入拆解队列; 已在队列里返回 false */
  enqueue(videoId: string): boolean;
  now(): Date;
}

/**
 * 粘链接: 主页 → 关注并读一遍作品; 作品 → 存下并拆解。
 * 已经拆过或正在拆的作品直接返回, 不再访问抖音(重复粘贴不该再下载一遍)。
 */
export async function handlePaste(deps: PasteDeps, target: LinkTarget): Promise<{ kind: 'video'; videoId: string } | { kind: 'account'; accountId: string }> {
  const { store, client } = deps;
  if (target.kind === 'user') {
    const { profile, works } = await client.fetchAccount(target.secUid);
    const acc = await store.upsertAccount(profile, { status: 'following', source: 'manual' });
    if (acc.status !== 'following') await store.updateAccount(acc.id, { status: 'following' });
    await applyAccountWorks(store, { ...acc, status: 'following' }, profile, works, deps.now());
    return { kind: 'account', accountId: acc.id };
  }
  const existing = await store.findVideoByAweme(target.awemeId);
  if (existing && (existing.analysisStatus === 'done' || existing.analysisStatus === 'running')) return { kind: 'video', videoId: existing.id };
  const w = await client.fetchDetail(target.awemeId);
  if (!w.authorSecUid) throw new DouyinRejectedError('读不到这条作品的博主，换一条链接试试');
  const acc = await store.upsertAccount(
    { secUid: w.authorSecUid, nickname: w.authorName, douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 },
    { status: 'candidate', source: 'link' },
  );
  const v = await store.upsertVideo(acc.id, w, deps.now());
  if (deps.enqueue(v.id)) await store.updateVideo(v.id, { analysisStatus: 'running', analysisError: null, analysisStartedAt: deps.now() });
  return { kind: 'video', videoId: v.id };
}
