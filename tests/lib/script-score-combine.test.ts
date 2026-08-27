import { describe, it, expect } from 'vitest';
import {
  scriptFingerprint,
  combineScore,
  readCachedSoft,
  SOFT_MODEL_VERSION,
} from '@/lib/cockpit/script-score';

const ACTS = [
  { act: 'hook', narration: '我靠给别人装一个开源项目赚到了第一笔钱。', visual: '出镜正面' },
  { act: 'punchline', narration: '别猜，去测。', visual: '出镜正面' },
];

describe('scriptFingerprint', () => {
  it('同一份稿子指纹一样', () => {
    expect(scriptFingerprint(ACTS)).toBe(scriptFingerprint(ACTS.map((a) => ({ ...a }))));
  });

  it('改了台词指纹就变 —— 分数才会失效', () => {
    const changed = [{ ...ACTS[0], narration: '换了个开头。' }, ACTS[1]];
    expect(scriptFingerprint(changed)).not.toBe(scriptFingerprint(ACTS));
  });

  it('只改画面说明也算改 —— 合规是按画面判的', () => {
    const changed = [{ ...ACTS[0], visual: '切到后台收款截图' }, ACTS[1]];
    expect(scriptFingerprint(changed)).not.toBe(scriptFingerprint(ACTS));
  });

  it('改了跟评分无关的字段不影响指纹 —— 不要动不动就让分数过期', () => {
    const withNote = ACTS.map((a) => ({ ...a, note: '拍摄提示改了一下', targetSec: 99 }));
    expect(scriptFingerprint(withNote)).toBe(scriptFingerprint(ACTS));
  });
});

describe('readCachedSoft — 评分模型版本', () => {
  it('缓存里没有版本号(改模型之前存的)一律当过期 —— 维度和满分都变了, 分数不可比', () => {
    const legacy = {
      fingerprint: scriptFingerprint(ACTS),
      dimensions: [{ key: 'failureNarrative', label: '失败叙事', score: 10, max: 15, reason: 'x' }],
      topFixes: [],
      scoredAt: '2026-08-27T00:00:00.000Z',
    };
    const r = readCachedSoft(legacy, ACTS);
    expect(r?.stale).toBe(true);
    expect(r?.staleReason).toBe('model');
  });

  it('版本对得上、指纹也对得上才算新鲜', () => {
    const fresh = {
      fingerprint: scriptFingerprint(ACTS),
      modelVersion: SOFT_MODEL_VERSION,
      dimensions: [{ key: 'hookPower', label: '钩子力度', score: 12, max: 15, reason: 'a' }],
      topFixes: [],
      scoredAt: '2026-08-28T00:00:00.000Z',
    };
    expect(readCachedSoft(fresh, ACTS)?.stale).toBe(false);
  });

  it('版本对但稿子改过 → 仍然过期, 原因是稿子', () => {
    const cached = {
      fingerprint: scriptFingerprint(ACTS),
      modelVersion: SOFT_MODEL_VERSION,
      dimensions: [{ key: 'hookPower', label: '钩子力度', score: 12, max: 15, reason: 'a' }],
      topFixes: [],
      scoredAt: '2026-08-28T00:00:00.000Z',
    };
    const changed = [{ ...ACTS[0], narration: '改过了。' }, ACTS[1]];
    const r = readCachedSoft(cached, changed);
    expect(r?.stale).toBe(true);
    expect(r?.staleReason).toBe('script');
  });
});

describe('readCachedSoft', () => {
  const soft = {
    fingerprint: scriptFingerprint(ACTS),
    modelVersion: SOFT_MODEL_VERSION,
    dimensions: [{ key: 'hookPower', label: '钩子力度', score: 15, max: 20, reason: 'a' }],
    topFixes: ['补一句扩圈'],
    scoredAt: '2026-08-28T00:00:00.000Z',
  };

  it('指纹对得上就认这份缓存', () => {
    expect(readCachedSoft(soft, ACTS)?.stale).toBe(false);
  });

  it('稿子改过就标记过期, 但仍然把旧分带出来给用户看', () => {
    const changed = [{ ...ACTS[0], narration: '改过了。' }, ACTS[1]];
    const r = readCachedSoft(soft, changed);
    expect(r?.stale).toBe(true);
    expect(r?.dimensions[0].score).toBe(15);
  });

  it('没有缓存返回 null', () => {
    expect(readCachedSoft(null, ACTS)).toBeNull();
    expect(readCachedSoft(undefined, ACTS)).toBeNull();
  });

  it('缓存结构不对当成没有 —— 旧数据 / 手改坏的 JSON 不能把页面搞崩', () => {
    expect(readCachedSoft({ nonsense: true }, ACTS)).toBeNull();
    expect(readCachedSoft('一个字符串', ACTS)).toBeNull();
  });
});

describe('combineScore', () => {
  it('没跑软指标时只报硬指标, 并说明满分只有 35', () => {
    const r = combineScore(ACTS, null);
    expect(r.softScored).toBe(false);
    expect(r.max).toBe(35);
    expect(r.total).toBe(r.dimensions.reduce((s, d) => s + d.score, 0));
    expect(r.dimensions).toHaveLength(6);
  });

  it('跑过软指标就是满分 100 的完整评分', () => {
    const soft = {
      fingerprint: scriptFingerprint(ACTS),
      modelVersion: SOFT_MODEL_VERSION,
      dimensions: [
        { key: 'hookPower', label: '钩子力度', score: 12, max: 15, reason: 'a' },
        { key: 'gain', label: '获得感', score: 10, max: 12, reason: 'b' },
        { key: 'surprise', label: '意外感', score: 9, max: 12, reason: 'c' },
        { key: 'authenticity', label: '真实感', score: 8, max: 10, reason: 'd' },
        { key: 'pivotClarity', label: '关键转向', score: 7, max: 8, reason: 'e' },
        { key: 'punchline', label: '金句收束', score: 6, max: 8, reason: 'f' },
      ],
      topFixes: [],
      scoredAt: '2026-08-28T00:00:00.000Z',
    };
    const r = combineScore(ACTS, soft);
    expect(r.softScored).toBe(true);
    expect(r.max).toBe(100);
    expect(r.dimensions).toHaveLength(12);
  });

  it('硬指标永远排在前面 —— 免费的先看, 要花钱的后看', () => {
    const soft = {
      fingerprint: scriptFingerprint(ACTS),
      modelVersion: SOFT_MODEL_VERSION,
      dimensions: [{ key: 'hookPower', label: '钩子力度', score: 15, max: 20, reason: 'a' }],
      topFixes: [],
      scoredAt: '2026-08-28T00:00:00.000Z',
    };
    const r = combineScore(ACTS, soft);
    expect(r.dimensions[0].key).toBe('duration');
    expect(r.dimensions[r.dimensions.length - 1].key).toBe('hookPower');
  });
});
