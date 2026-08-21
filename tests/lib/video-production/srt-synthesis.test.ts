import { describe, expect, it } from 'vitest';
import {
  buildSrtFromAlignedActs,
  synthesizeSrtFromSixActScript,
  ttsResultsToAlignedActs,
  type TtsActResult,
} from '@/lib/video-production/srt-synthesis';
import { ACT_KEYS, type ActKey, type ScriptAct } from '@/lib/script/six-act';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';

/** 构造一个最小合法幕, 供各测试按需覆盖字段 (风格对齐 tests/lib/script/six-act.test.ts)。 */
function makeAct(act: ActKey, overrides: Partial<ScriptAct> = {}): ScriptAct {
  return {
    act,
    title: '标题',
    narration: '这是一段口播文案。',
    visual: '画面提示',
    note: '备注说明',
    targetSec: 10,
    beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }],
    facts: [],
    ...overrides,
  };
}

/** 拆分 SRT 文本为条目数组 (按空行分隔), 便于逐条断言。 */
function splitEntries(srt: string): string[] {
  return srt
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('synthesizeSrtFromSixActScript', () => {
  it('单幕单句: 该句独占整幕 targetSec', () => {
    const acts = [makeAct('hook', { narration: '这是唯一一句。', targetSec: 10 })];
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe('1\n00:00:00,000 --> 00:00:10,000\n这是唯一一句。');
  });

  it('单幕多句: 按字数占比分配时长, 总和精确等于幕时长', () => {
    const acts = [
      makeAct('hook', {
        narration: '短句。这是一个明显更长一些的句子。',
        targetSec: 9,
      }),
    ];
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(2);

    const parseDurationMs = (entry: string): number => {
      const match = entry.match(
        /(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/,
      );
      if (!match) throw new Error(`无法解析时间戳: ${entry}`);
      const toMs = (h: string, m: string, s: string, ms: string) =>
        Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
      const start = toMs(match[1], match[2], match[3], match[4]);
      const end = toMs(match[5], match[6], match[7], match[8]);
      return end - start;
    };

    const shortDuration = parseDurationMs(entries[0]);
    const longDuration = parseDurationMs(entries[1]);
    expect(shortDuration + longDuration).toBe(9000);
    expect(longDuration).toBeGreaterThan(shortDuration);
  });

  it('多幕累计: 第二幕第一条 SRT 的起始时间戳等于第一幕的 targetSec', () => {
    const acts = [
      makeAct('hook', { narration: '第一幕的句子。', targetSec: 5 }),
      makeAct('concept_a', { narration: '第二幕的句子。', targetSec: 5 }),
    ];
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toContain('00:00:05,000 --> 00:00:10,000');
  });

  it('空 narration 幕: 不产生条目, 但游标仍前进 targetSec', () => {
    const acts = [
      makeAct('hook', { narration: '', targetSec: 4 }),
      makeAct('concept_a', { narration: '第二幕的句子。', targetSec: 6 }),
    ];
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('00:00:04,000 --> 00:00:10,000');
  });

  it('narration 切不出句子 (无终止标点) 同样跳过整幕, 游标仍前进', () => {
    const acts = [
      makeAct('hook', { narration: '没有终止标点的文字', targetSec: 3 }),
      makeAct('concept_a', { narration: '第二幕的句子。', targetSec: 6 }),
    ];
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('00:00:03,000 --> 00:00:09,000');
  });

  it('六幕全部处理: 条目数与总时长等于 6 幕 targetSec 之和', () => {
    const acts: ScriptAct[] = ACT_KEYS.map((act, i) =>
      makeAct(act, {
        narration: `这是第${i + 1}幕的第一句。这是第${i + 1}幕的第二句子哦。`,
        targetSec: 5 + i,
      }),
    );
    const totalSec = acts.reduce((sum, a) => sum + a.targetSec, 0);
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(12);

    const lastEntry = entries[entries.length - 1];
    const endMatch = lastEntry.match(/--> (\d\d):(\d\d):(\d\d),(\d\d\d)/);
    expect(endMatch).not.toBeNull();
    const [, h, m, s, ms] = endMatch as RegExpMatchArray;
    const endMs = Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
    expect(endMs).toBe(totalSec * 1000);
  });

  it('序号从 1 开始连续递增, 不因空幕跳号', () => {
    const acts = [
      makeAct('hook', { narration: '第一幕的句子。', targetSec: 3 }),
      makeAct('concept_a', { narration: '', targetSec: 2 }),
      makeAct('concept_b', { narration: '第三幕的句子。', targetSec: 3 }),
    ];
    const srt = synthesizeSrtFromSixActScript(acts);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(2);
    expect(entries[0].startsWith('1\n')).toBe(true);
    expect(entries[1].startsWith('2\n')).toBe(true);
  });
});

describe('buildSrtFromAlignedActs', () => {
  const narrations: Record<string, string> = {
    hook: '开场钩子文本',
    concept_a: '概念A文本',
    concept_b: '概念B文本',
    trivia: '冷知识文本',
    synthesis: '知识串联文本',
    punchline: '金句收尾文本',
  };

  it('6 幕全部非零时长 → 产出 6 个 SRT 块, 序号 1-6', () => {
    const alignedActs: AlignedAct[] = ACT_KEYS.map((act, i) => ({
      act,
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
    }));
    const srt = buildSrtFromAlignedActs(alignedActs, narrations);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(6);
    entries.forEach((entry, i) => {
      expect(entry.startsWith(`${i + 1}\n`)).toBe(true);
    });
  });

  it('某一幕零时长 (startMs===endMs) → 该幕被跳过, 序号仍连续', () => {
    const alignedActs: AlignedAct[] = [
      { act: 'hook', startMs: 0, endMs: 1000 },
      { act: 'concept_a', startMs: 1000, endMs: 1000 },
      { act: 'concept_b', startMs: 1000, endMs: 2000 },
      { act: 'trivia', startMs: 2000, endMs: 3000 },
      { act: 'synthesis', startMs: 3000, endMs: 4000 },
      { act: 'punchline', startMs: 4000, endMs: 5000 },
    ];
    const srt = buildSrtFromAlignedActs(alignedActs, narrations);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(5);
    expect(entries[0].startsWith('1\n')).toBe(true);
    expect(entries[1].startsWith('2\n')).toBe(true);
    expect(entries[4].startsWith('5\n')).toBe(true);
    expect(entries.some((e) => e.includes('概念A文本'))).toBe(false);
  });

  it('时间戳格式正确: HH:MM:SS,mmm --> HH:MM:SS,mmm', () => {
    const alignedActs: AlignedAct[] = [{ act: 'hook', startMs: 1234, endMs: 5678 }];
    const srt = buildSrtFromAlignedActs(alignedActs, narrations);
    const entries = splitEntries(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(
      /^1\n\d\d:\d\d:\d\d,\d\d\d --> \d\d:\d\d:\d\d,\d\d\d\n/,
    );
  });

  it('narrations 缺失某个非零时长幕的文本 → 抛出明确错误, 而非静默产出 "undefined"', () => {
    const alignedActs: AlignedAct[] = [{ act: 'hook', startMs: 0, endMs: 1000 }];
    const { hook: _hook, ...incompleteNarrations } = narrations;
    expect(() => buildSrtFromAlignedActs(alignedActs, incompleteNarrations)).toThrow(/hook/);
  });
});

describe('ttsResultsToAlignedActs', () => {
  it('6 幕顺序输入 → 按 durationMs 累加出正确的 startMs/endMs', () => {
    const results: TtsActResult[] = ACT_KEYS.map((act, i) => ({
      act,
      audioPath: `/tmp/${act}.wav`,
      durationMs: 1000 * (i + 1),
    }));
    const aligned = ttsResultsToAlignedActs(results);
    expect(aligned).toHaveLength(6);

    let cursor = 0;
    aligned.forEach((a, i) => {
      expect(a.act).toBe(ACT_KEYS[i]);
      expect(a.startMs).toBe(cursor);
      cursor += results[i].durationMs;
      expect(a.endMs).toBe(cursor);
    });
  });

  it('0 时长边界: 不产生负数或 NaN, 该幕零时长且不影响后续累加', () => {
    const results: TtsActResult[] = [
      { act: 'hook', audioPath: '/tmp/hook.wav', durationMs: 0 },
      { act: 'concept_a', audioPath: '/tmp/concept_a.wav', durationMs: 2000 },
    ];
    const aligned = ttsResultsToAlignedActs(results);
    expect(aligned).toEqual<AlignedAct[]>([
      { act: 'hook', startMs: 0, endMs: 0 },
      { act: 'concept_a', startMs: 0, endMs: 2000 },
    ]);
    aligned.forEach((a) => {
      expect(a.startMs).toBeGreaterThanOrEqual(0);
      expect(a.endMs).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(a.startMs)).toBe(false);
      expect(Number.isNaN(a.endMs)).toBe(false);
    });
  });
});
