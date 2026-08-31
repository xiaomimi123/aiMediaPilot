import { describe, it, expect } from 'vitest';
import { actWindows, FILM_PLAN } from '@/lib/video-production/film-plan-prompt';
import { describeCardsForPrompt } from '@/lib/video-production/shot-plan';
import type { ScriptAct } from '@/lib/script/six-act';

const acts = [
  { act: 'hook', title: '钩子', narration: '刷到过三天赚五千吗', targetSec: 9, facts: [] },
  { act: 'concept_a', title: '现实', narration: '月均成交额不足九百元', targetSec: 11, facts: [] },
] as unknown as ScriptAct[];

describe('actWindows', () => {
  it('按 targetSec 累加出毫秒时间窗, 首尾相接不留缝', () => {
    expect(actWindows(acts)).toEqual([
      { act: 'hook', title: '钩子', startMs: 0, endMs: 9000, narration: '刷到过三天赚五千吗' },
      { act: 'concept_a', title: '现实', startMs: 9000, endMs: 20000, narration: '月均成交额不足九百元' },
    ]);
  });

  it('空稿返回空表, 不抛错', () => {
    expect(actWindows([])).toEqual([]);
  });
});

describe('FILM_PLAN.buildSystemPrompt', () => {
  it('内嵌卡片说明原文 —— 卡片库是唯一事实来源, 不许在这里另写一套', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toContain(describeCardsForPrompt());
  });

  it('明确要求时间窗内铺满、不留空档、不许重叠', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toMatch(/不留空档|不要留空/);
    expect(p).toContain('不许重叠');
  });

  it('只输出 JSON, 不要 markdown 代码块 —— 与 DIRECTOR 的既有约定一致', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toContain('只输出 JSON');
  });
});

describe('FILM_PLAN.buildUserMessage', () => {
  it('把每一幕的时间窗与台词都给到模型', () => {
    const [part] = FILM_PLAN.buildUserMessage(actWindows(acts));
    expect(part.type).toBe('text');
    const text = (part as { text: string }).text;
    expect(text).toContain('0 ~ 9000');
    expect(text).toContain('9000');
    expect(text).toContain('刷到过三天赚五千吗');
  });
});

describe('FILM_PLAN.buildSystemPrompt 短幕例外', () => {
  it('讲清楚幕本身短于 1200 毫秒时怎么办 —— 铺满不留空档优先于最短镜长', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toMatch(/一幕本身的时间窗就短于 1200 毫秒|时间窗短于 1200/);
    expect(p).toContain('铺满不留空档');
  });
});
