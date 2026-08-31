import { describe, it, expect } from 'vitest';
import { getBundle } from '@/lib/video-production/remotion-render';

/*
 * bundle 复用是这次迁移的一个关键成本项 —— spec §7 把它列为"实施第一步就要量"的未知数。
 * 实测: bundle 一次 0.8 秒, 两个 composition 复用同一份。所以 getBundle 必须缓存,
 * 每条片子重新 bundle 会把渲染提速的优势吃掉一大半。
 */

describe('getBundle', () => {
  it('同一进程内只 bundle 一次 —— 第二次调用直接返回缓存', async () => {
    const a = await getBundle();
    const t0 = Date.now();
    const b = await getBundle();
    const elapsed = Date.now() - t0;
    expect(b).toBe(a);
    // 缓存命中应当是毫秒级; 给 200ms 余量避免机器抖动误判
    expect(elapsed).toBeLessThan(200);
  }, 120_000);
});
