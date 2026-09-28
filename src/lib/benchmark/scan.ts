import type { ParsedProfile, ParsedWork } from './parse';
import type { AccountRow, BenchmarkStore, VideoRow } from './store';
import { computeBaseline, judge } from './rules';
import { EgoUnavailableError } from '@/lib/ego';
import { DouyinRejectedError } from './parse';
import type { DouyinClient } from './douyin';

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

export const MAX_ACCOUNTS_PER_NIGHT = 15;
export const MAX_AUTO_ANALYZE = 5;
export const STOP_AFTER_REJECTS = 3;

export interface ScanDeps {
  store: BenchmarkStore;
  client: Pick<DouyinClient, 'fetchAccount'>;
  analyze(videoId: string): Promise<boolean>;
  log(msg: string): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  random(): number;
}

/** 每晚巡检。只读、限量、有间隔; 被连续拒绝就停, 不硬撞风控。 */
export async function runScan(deps: ScanDeps) {
  deps.log('开始巡检');
  const accounts = (await deps.store.listAccounts('following'))
    .sort((a, b) => (a.lastCheckedAt?.getTime() ?? 0) - (b.lastCheckedAt?.getTime() ?? 0))
    .slice(0, MAX_ACCOUNTS_PER_NIGHT);
  const r = { accounts: 0, failed: 0, newWorks: 0, hits: 0, analyzed: 0, stopped: false };
  const hits: VideoRow[] = [];
  let rejects = 0;
  for (const [i, acc] of accounts.entries()) {
    if (i > 0) await deps.sleep(5000 + Math.round(deps.random() * 5000));
    r.accounts++;
    try {
      const { profile, works } = await deps.client.fetchAccount(acc.secUid);
      const a = await applyAccountWorks(deps.store, acc, profile, works, deps.now());
      r.newWorks += a.newWorks;
      hits.push(...a.newHits);
      rejects = 0;
    } catch (e) {
      r.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof EgoUnavailableError) {
        deps.log(msg);
        r.stopped = true;
        break;
      }
      deps.log(`账号 ${acc.nickname}(${acc.secUid}) 巡检失败: ${msg}`);
      if (e instanceof DouyinRejectedError && ++rejects >= STOP_AFTER_REJECTS) {
        deps.log(`疑似触发风控，已停止(连续 ${STOP_AFTER_REJECTS} 个账号被拒)`);
        r.stopped = true;
        break;
      }
    }
  }
  r.hits = hits.length;
  if (r.stopped) return r;
  const toAnalyze = hits.filter((h) => h.analysisStatus === 'none').sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, MAX_AUTO_ANALYZE);
  for (const h of toAnalyze) if (await deps.analyze(h.id)) r.analyzed++;
  deps.log(`巡检完成: 账号 ${r.accounts} 个(失败 ${r.failed}) / 新作品 ${r.newWorks} 条 / 爆款 ${r.hits} 条 / 拆解 ${r.analyzed} 条`);
  return r;
}
