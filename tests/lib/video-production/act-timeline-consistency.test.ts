import { describe, it, expect } from 'vitest';
import { actWindows } from '@/lib/video-production/film-plan-prompt';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';
import type { ScriptAct } from '@/lib/script/six-act';

/**
 * 守住 `actWindows`(film-plan-prompt.ts)与
 * `synthesizeSrtFromSixActScript`(srt-synthesis.ts)之间的一条隐性契约:
 * 两个函数各自把同一份六幕稿换算成毫秒时间轴, 前者喂给模型编排画面,
 * 后者合成字幕 SRT——**它们必须给出完全一样的幕边界**, 否则画面会和
 * 字幕/配音悄悄错位, 而且不会有任何报错。
 *
 * 这条契约曾经系在 "targetSec 恒为整数" 这个假设上(所以 actWindows 里的
 * Math.round 被当作无害的防御性写法)。但 Remotion 链实际的读取路径
 * (SixActDraftSchema、工作区自动保存端点)都不保证 targetSec 是整数, 分数秒
 * 完全可能真的进来——本测试专门覆盖分数秒, 用逐幕累加会真的产生"每一幕单独
 * Math.round 再累加"与"先累加再统一取整"之间的漂移的输入, 钉住两边必须
 * 一致这条契约。
 *
 * 比较口径: SRT 是文本格式, 时间戳天然只能表示到整数毫秒(见 srt-synthesis.ts
 * 的 formatTimestamp), 所以从 SRT 解析回来的时间戳本身就是整数。为了公平比较,
 * 对 actWindows 产出的(可能带小数的)边界同样取整到最近毫秒再比较——这与
 * "把这份时间轴烧录成 SRT 时会显示成第几毫秒"是同一件事, 不是放宽断言。
 */

/** 从 synthesizeSrtFromSixActScript 产出的标准 SRT 里, 取每一条字幕块的 [startMs, endMs]。 */
function parseSrtTimings(srt: string): Array<{ startMs: number; endMs: number }> {
  const timeRe = /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g;
  const toMs = (h: string, m: string, s: string, ms: string) =>
    Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
  const result: Array<{ startMs: number; endMs: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = timeRe.exec(srt)) !== null) {
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    result.push({ startMs: toMs(h1, m1, s1, ms1), endMs: toMs(h2, m2, s2, ms2) });
  }
  return result;
}

function makeAct(overrides: Partial<ScriptAct> & { act: ScriptAct['act'] }): ScriptAct {
  return {
    title: overrides.act,
    narration: '',
    visual: '',
    note: '',
    targetSec: 10,
    beats: [],
    facts: [],
    ...overrides,
  } as ScriptAct;
}

describe('actWindows 与 synthesizeSrtFromSixActScript 的幕边界必须逐位一致(取整到毫秒后比较)', () => {
  it('整数秒(现状): 两边给出完全相同的幕边界', () => {
    const acts: ScriptAct[] = [
      makeAct({ act: 'hook', narration: '刷到过三天赚五千吗。真的假的。', targetSec: 9 }),
      makeAct({ act: 'concept_a', narration: '月均成交额不足九百元。', targetSec: 11 }),
      makeAct({ act: 'concept_b', narration: '大多数人赚不到钱。', targetSec: 7 }),
    ];

    const windows = actWindows(acts);
    const srt = synthesizeSrtFromSixActScript(acts);
    const timings = parseSrtTimings(srt);

    // hook 幕产两条字幕(索引 0、1), concept_a 一条(索引 2), concept_b 一条(索引 3)。
    expect(Math.round(windows[0].endMs)).toBe(timings[1].endMs);
    expect(Math.round(windows[1].endMs)).toBe(timings[2].endMs);
    expect(Math.round(windows[2].endMs)).toBe(timings[3].endMs);
    expect(Math.round(windows[0].endMs)).toBe(timings[2].startMs);
    expect(Math.round(windows[1].endMs)).toBe(timings[3].startMs);
  });

  it('分数秒、连续多幕累积: 每一幕单独 Math.round 再累加, 与先累加不取整会在第二幕起就漂移——两边必须仍然一致', () => {
    // 9.0006 * 1000 = 9000.6, 单独 Math.round 得 9001(多算 0.4ms/幕)。
    // 三幕累加后, "逐幕先 round 再加"与"先加总量不取整"之间的差会超过 0.5ms 半毫秒边界,
    // 导致取整到毫秒后落到不同的整数——这正是本测试要钉住不能再发生的分叉。
    const acts: ScriptAct[] = [
      makeAct({ act: 'hook', narration: '刷到过三天赚五千吗。', targetSec: 9.0006 }),
      makeAct({ act: 'concept_a', narration: '月均成交额不足九百元。', targetSec: 9.0006 }),
      makeAct({ act: 'concept_b', narration: '大多数人赚不到钱。', targetSec: 9.0006 }),
    ];

    const windows = actWindows(acts);
    const srt = synthesizeSrtFromSixActScript(acts);
    const timings = parseSrtTimings(srt);

    // 每一幕 narration 只切出一句, 各产一条字幕, 索引与幕一一对应。
    expect(timings).toHaveLength(3);
    expect(Math.round(windows[0].endMs)).toBe(timings[0].endMs);
    expect(Math.round(windows[1].endMs)).toBe(timings[1].endMs);
    expect(Math.round(windows[2].endMs)).toBe(timings[2].endMs);
    expect(Math.round(windows[1].startMs)).toBe(timings[1].startMs);
    expect(Math.round(windows[2].startMs)).toBe(timings[2].startMs);
  });

  it('narration 为空的幕(不产字幕, 但游标仍推进 targetSec, 分数秒): 两边边界依然一致', () => {
    const acts: ScriptAct[] = [
      makeAct({ act: 'hook', narration: '刷到过三天赚五千吗。', targetSec: 9.5 }),
      // concept_a 没有可切出的句子(空 narration): synthesizeSrtFromSixActScript
      // 不产字幕条目, 但 cursorMs 仍要推进 targetSec —— 这条路径也必须与
      // actWindows 的边界一致。
      makeAct({ act: 'concept_a', narration: '', targetSec: 4.2 }),
      makeAct({ act: 'concept_b', narration: '大多数人赚不到钱。', targetSec: 6.7 }),
    ];

    const windows = actWindows(acts);
    const srt = synthesizeSrtFromSixActScript(acts);
    const timings = parseSrtTimings(srt);

    // 只有两条字幕(hook 一条, concept_b 一条), concept_a 完全不产字幕。
    expect(timings).toHaveLength(2);
    expect(Math.round(windows[0].endMs)).toBe(timings[0].endMs);
    // concept_b 的字幕必须从 "hook.endMs + concept_a.targetSec" 开始,
    // 也就是 actWindows 里 concept_b 的 startMs。
    expect(Math.round(windows[2].startMs)).toBe(timings[1].startMs);
    expect(Math.round(windows[2].endMs)).toBe(timings[1].endMs);
  });
});
