import type { ParsedProfile, ParsedWork } from './parse';
import type { AccountRow, BenchmarkStore, VideoRow } from './store';
import { computeBaseline, judge } from './rules';

/** 写入一个账号本次读到的资料与作品, 重算平时水平与爆款; 返回本次"新"判定的爆款(hitAt 首次设置) */
export async function applyAccountWorks(
  store: BenchmarkStore,
  account: AccountRow,
  profile: ParsedProfile,
  works: ParsedWork[],
  now: Date,
): Promise<{ newWorks: number; newHits: VideoRow[] }> {
  await store.upsertAccount(profile, { status: account.status, source: account.source });
  const before = new Set((await store.listVideos({ accountId: account.id })).map((v) => v.awemeId));
  for (const w of works) await store.upsertVideo(account.id, w, now);
  const all = await store.listVideos({ accountId: account.id });
  const baseline = computeBaseline(all, now);
  await store.updateAccount(account.id, { baselineDigg: baseline, lastCheckedAt: now });
  const newHits: VideoRow[] = [];
  for (const v of all) {
    const { ratio, isHit } = judge(v, baseline, now);
    const firstHit = isHit && !v.hitAt;
    const hitAt = firstHit ? now : v.hitAt;
    if (ratio !== v.ratio || isHit !== v.isHit || firstHit) await store.updateVideo(v.id, { ratio, isHit, hitAt });
    if (firstHit) newHits.push({ ...v, ratio, isHit, hitAt });
  }
  return { newWorks: works.filter((w) => !before.has(w.awemeId)).length, newHits };
}
