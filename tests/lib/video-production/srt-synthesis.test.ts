import { describe, expect, it } from 'vitest';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';
import { ACT_KEYS, type ActKey, type ScriptAct } from '@/lib/script/six-act';

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
