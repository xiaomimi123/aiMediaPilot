import { describe, it, expect } from 'vitest';
import { buildFreezeDetectArgs, parseFreezeOutput, judgeFreeze } from '@/lib/video/freeze-check';

describe('buildFreezeDetectArgs', () => {
  it('用 ffmpeg 的 freezedetect, 不解码整片', () => {
    const a = buildFreezeDetectArgs('/x/v.mp4', { minSec: 0.8, noise: 0.003 });
    expect(a.join(' ')).toContain('freezedetect=n=0.003:d=0.8');
    expect(a).toContain('-an');
    expect(a.at(-1)).toBe('-');
  });
});

describe('parseFreezeOutput', () => {
  it('从 stderr 里解出每段静止的起止', () => {
    const out = [
      '[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 12.5',
      '[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 2.4',
      '[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 14.9',
    ].join('\n');
    expect(parseFreezeOutput(out)).toEqual([{ startSec: 12.5, durationSec: 2.4 }]);
  });

  it('没有静止段时是空数组', () => {
    expect(parseFreezeOutput('nothing here')).toEqual([]);
  });

  it('多段都要解出来', () => {
    const out = `freeze_start: 1.0\nfreeze_duration: 1.5\nfreeze_start: 30.0\nfreeze_duration: 0.9`;
    expect(parseFreezeOutput(out).length).toBe(2);
  });
});

describe('judgeFreeze', () => {
  it('没有静止段 → 过', () => {
    expect(judgeFreeze([], 100).ok).toBe(true);
  });

  it('静止总时长占比超过阈值 → 拦, 并说出在哪几秒', () => {
    const r = judgeFreeze([{ startSec: 10, durationSec: 6 }, { startSec: 40, durationSec: 5 }], 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('10');
  });

  it('偶尔一小段不误伤 —— 口播本来就有停顿的镜头', () => {
    expect(judgeFreeze([{ startSec: 10, durationSec: 1.2 }], 100).ok).toBe(true);
  });
});

import { runFreezeDetect } from '@/lib/video/freeze-check';

/**
 * 锁住一次真实事故: 用 execFileSync 只在抛异常时取 stderr, 而 freezedetect 正常退出,
 * 于是永远拿到空字符串、检测「全部通过」。造一条后 10 秒纯色的片子才发现 —— ffmpeg
 * 明明打了 freeze_start: 5, 我这边解出 0 段。
 */
describe('runFreezeDetect 必须在正常退出时也收到 stderr', () => {
  it('注入的 exec 返回诊断文本时, 能解出静止段', async () => {
    const segs = await runFreezeDetect('/x/v.mp4', { minSec: 0.8, noise: 0.003 }, async () => ({
      stderr: '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_start: 5\n' +
              '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_duration: 10',
    }));
    expect(segs).toEqual([{ startSec: 5, durationSec: 10 }]);
  });
});

describe('静止一直持续到片尾', () => {
  it('只有 freeze_start 没有 duration 时, 补到片尾', () => {
    const out = 'lavfi.freezedetect.freeze_start: 5';
    expect(parseFreezeOutput(out, 15)).toEqual([{ startSec: 5, durationSec: 10 }]);
  });

  it('不给片长时只能丢掉那一段 —— 行为要可预期', () => {
    expect(parseFreezeOutput('lavfi.freezedetect.freeze_start: 5')).toEqual([]);
  });
});
