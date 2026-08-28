import { describe, it, expect } from 'vitest';
import { buildLoopStatus, CALIBRATION_MIN_SAMPLES } from '@/lib/cockpit/feedback-loop';

const base = { scriptCount: 0, publishedCount: 0, measuredCount: 0 };

describe('buildLoopStatus', () => {
  it('三层: 快 / 中 / 慢', () => {
    expect(buildLoopStatus(base).map((l) => l.key)).toEqual(['fast', 'mid', 'slow']);
  });

  it('有稿子就说明快回路在转 —— 它只依赖写稿本身', () => {
    expect(buildLoopStatus({ ...base, scriptCount: 6 })[0].state).toBe('running');
  });

  it('一份稿子都没有时快回路也还没转起来', () => {
    expect(buildLoopStatus(base)[0].state).toBe('idle');
  });

  it('发布 0 条 → 中回路在等发布, 并指出它等的是谁', () => {
    const mid = buildLoopStatus({ ...base, scriptCount: 6 })[1];
    expect(mid.state).toBe('waiting');
    expect(mid.waitingFor).toContain('发布');
  });

  it('慢回路等中回路 —— 不是并列关系, 是串联', () => {
    const slow = buildLoopStatus({ ...base, scriptCount: 6 })[2];
    expect(slow.state).toBe('waiting');
    expect(slow.waitingFor).toContain('中回路');
  });

  it('已发布但还没回采 → 中回路仍在等, 等的换成回采', () => {
    const mid = buildLoopStatus({ scriptCount: 6, publishedCount: 3, measuredCount: 0 })[1];
    expect(mid.state).toBe('waiting');
    expect(mid.waitingFor).toContain('回采');
  });

  it('有回采数据 → 中回路转起来', () => {
    const mid = buildLoopStatus({ scriptCount: 6, publishedCount: 3, measuredCount: 3 })[1];
    expect(mid.state).toBe('running');
  });

  it('样本没到门槛时慢回路报还差多少条 —— 不说"再等等"', () => {
    const slow = buildLoopStatus({ scriptCount: 40, publishedCount: 10, measuredCount: 10 })[2];
    expect(slow.state).toBe('waiting');
    expect(slow.waitingFor).toContain(String(CALIBRATION_MIN_SAMPLES - 10));
  });

  it('样本够了 → 慢回路可以跑', () => {
    const slow = buildLoopStatus({
      scriptCount: 40, publishedCount: 40, measuredCount: CALIBRATION_MIN_SAMPLES,
    })[2];
    expect(slow.state).toBe('running');
  });

  it('每一层都说明它在干什么, 不是只给个状态词', () => {
    for (const l of buildLoopStatus(base)) {
      expect(l.what.length).toBeGreaterThan(8);
      expect(l.period.length).toBeGreaterThan(0);
    }
  });
});
