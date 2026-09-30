import { describe, expect, it, vi } from 'vitest';
import { runScan, type ScanDeps } from '@/lib/benchmark/scan';
import { DouyinRejectedError, DouyinLoginError, type ParsedWork } from '@/lib/benchmark/parse';
import { EgoUnavailableError } from '@/lib/ego';
import { createMemoryStore } from '../../helpers/benchmark-store';

const now = new Date('2026-09-28T12:30:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const work = (id: string, digg: number, d: number): ParsedWork => ({ awemeId: id, desc: id, url: 'u', publishedAt: daysAgo(d), durationSec: 60, digg, comment: 0, collect: 0, share: 0, isTop: false, playUrls: ['u'], authorSecUid: '', authorName: '' });
const prof = (sec: string) => ({ secUid: sec, nickname: sec, douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 });

async function setup(n: number, fetchAccount: ScanDeps['client']['fetchAccount']) {
  const store = createMemoryStore();
  for (let i = 0; i < n; i++) await store.upsertAccount(prof(`MS4w${i}`), { status: 'following', source: 'manual' });
  const logs: string[] = [];
  const deps: ScanDeps = { store, client: { fetchAccount }, analyze: vi.fn(async () => true), log: (m) => logs.push(m), sleep: vi.fn(async () => {}), now: () => now, random: () => 0.5 };
  return { store, deps, logs };
}

describe('runScan', () => {
  it('checks following accounts, sleeps between them, auto-analyzes new hits', async () => {
    const { deps, logs } = await setup(2, async (sec) => ({ profile: prof(sec), works: [work(`${sec}-1`, 1000, 1), work(`${sec}-2`, 1000, 2), work(`${sec}-3`, 1000, 3), work(`${sec}-4`, 9000, 1)] }));
    const r = await runScan(deps);
    expect(r).toMatchObject({ accounts: 2, failed: 0, hits: 2, analyzed: 2, stopped: false });
    expect(deps.sleep).toHaveBeenCalledWith(7500);
    expect(logs[0]).toBe('开始巡检');
    expect(logs.at(-1)).toBe('巡检完成: 账号 2 个(失败 0) / 新作品 8 条 / 爆款 2 条 / 拆解 2 条');
  });
  it('keeps going when one account fails', async () => {
    const { deps, logs } = await setup(3, async (sec) => {
      if (sec === 'MS4w1') throw new DouyinRejectedError('抖音拒绝了请求(HTTP 403)');
      return { profile: prof(sec), works: [] };
    });
    const r = await runScan(deps);
    expect(r).toMatchObject({ accounts: 3, failed: 1, stopped: false });
    expect(logs.some((l) => l.includes('MS4w1') && l.includes('HTTP 403'))).toBe(true);
  });
  it('stops after 3 rejections in a row', async () => {
    const { deps, logs } = await setup(5, async () => {
      throw new DouyinRejectedError('抖音拒绝了请求(HTTP 403)');
    });
    const r = await runScan(deps);
    expect(r.stopped).toBe(true);
    expect(logs.some((l) => l.includes('疑似触发风控，已停止'))).toBe(true);
    expect(logs.at(-1)).not.toContain('巡检完成');
  });
  it('stops at once when ego is unavailable', async () => {
    const { deps, logs } = await setup(3, async () => {
      throw new EgoUnavailableError('ego lite 没有响应');
    });
    const r = await runScan(deps);
    expect(r).toMatchObject({ stopped: true, failed: 1 });
    expect(logs.some((l) => l.startsWith('ego lite 没有响应'))).toBe(true);
  });
  it('stops at once on a lost login and says to re-login', async () => {
    const { deps, logs } = await setup(3, async () => {
      throw new DouyinLoginError();
    });
    const r = await runScan(deps);
    expect(r).toMatchObject({ stopped: true, failed: 1 });
    expect(logs.some((l) => l.includes('打开 ego lite 重新登录'))).toBe(true);
    expect(logs.some((l) => l.includes('风控'))).toBe(false);
  });
  it('analyzes at most 5 new hits, highest ratio first', async () => {
    const { deps } = await setup(1, async (sec) => ({ profile: prof(sec), works: [1, 2, 3, 4, 5, 6, 7].map((i) => work(`b${i}`, 1000, i)).concat([1, 2, 3, 4, 5, 6].map((i) => work(`h${i}`, 3000 + i * 1000, 1))) }));
    await runScan(deps);
    expect(deps.analyze).toHaveBeenCalledTimes(5);
  });
});
