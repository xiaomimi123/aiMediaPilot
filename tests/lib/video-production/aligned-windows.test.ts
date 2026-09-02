import { describe, it, expect } from 'vitest';
import { actWindowsFromAligned } from '@/lib/video-production/film-plan-prompt';
import { sentenceCaptionEvents, splitSentences } from '@/lib/video-production/srt-synthesis';
import type { ScriptAct } from '@/lib/script/six-act';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';

const acts = [
  { act: 'hook', title: '钩子', narration: '第一句。第二句更长一些。', targetSec: 9, facts: [] },
  { act: 'concept_a', title: '现实', narration: '只有一句。', targetSec: 11, facts: [] },
] as unknown as ScriptAct[];
// 真实 TTS 时长与 targetSec 故意不同 —— 这正是要用 aligned 的理由
const aligned: AlignedAct[] = [
  { act: 'hook', startMs: 0, endMs: 8400 },
  { act: 'concept_a', startMs: 8400, endMs: 21000 },
] as AlignedAct[];

describe('actWindowsFromAligned', () => {
  it('时间来自 aligned, 文字来自 acts', () => {
    const w = actWindowsFromAligned(acts, aligned);
    expect(w).toEqual([
      { act: 'hook', title: '钩子', startMs: 0, endMs: 8400, narration: '第一句。第二句更长一些。' },
      { act: 'concept_a', title: '现实', startMs: 8400, endMs: 21000, narration: '只有一句。' },
    ]);
  });
  it('aligned 里缺的幕不产窗口 —— 没配音的幕不该有画面', () => {
    const w = actWindowsFromAligned(acts, [aligned[0]]);
    expect(w).toHaveLength(1);
    expect(w[0].act).toBe('hook');
  });
});

describe('sentenceCaptionEvents', () => {
  it('幕窗口内按句字符比例切分, 首尾相接', () => {
    const ev = sentenceCaptionEvents(acts, aligned);
    // hook 两句: '第一句。'(4字) '第二句更长一些。'(8字), 8400ms 按 4:8 分
    expect(ev[0]).toEqual({ startMs: 0, endMs: 2800, text: '第一句。' });
    expect(ev[1].startMs).toBe(2800);
    expect(ev[1].endMs).toBe(8400);
    expect(ev[2]).toEqual({ startMs: 8400, endMs: 21000, text: '只有一句。' });
  });
  it('与 splitSentences 的切法一致 —— 共享同一实现, 不是复制品', () => {
    expect(splitSentences('第一句。第二句更长一些。')).toEqual(['第一句。', '第二句更长一些。']);
  });

  it('字符占比取整有余数时, 末句吃余数, 首尾精确相接不产生缝隙', () => {
    // 3 句, 字符数 2:3:4 (共 9 字), 窗口 10000ms —— 10000*2/9 与 10000*3/9 都不能整除,
    // 若末句不吃余数而各自独立取整(简单除法), 三段之和会比 10000 少 1ms, 出现缝隙。
    const unevenActs = [
      { act: 'hook', title: '钩子', narration: '甲。乙丙。丁戊己。', targetSec: 10, facts: [] },
    ] as unknown as ScriptAct[];
    const unevenAligned: AlignedAct[] = [
      { act: 'hook', startMs: 0, endMs: 10000 },
    ] as AlignedAct[];
    const ev = sentenceCaptionEvents(unevenActs, unevenAligned);
    expect(ev).toHaveLength(3);
    // 首尾相接: 每句的 startMs 等于上一句的 endMs
    expect(ev[1].startMs).toBe(ev[0].endMs);
    expect(ev[2].startMs).toBe(ev[1].endMs);
    // 末句必须精确顶到窗口终点, 不允许因取整余数产生缝隙
    expect(ev[2].endMs).toBe(10000);
  });
});
