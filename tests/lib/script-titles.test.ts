import { describe, it, expect } from 'vitest';
import {
  SCRIPT_TITLES,
  checkTitleGrounding,
  ScriptTitlesResponseSchema,
} from '@/lib/llm/prompts/script-titles';

const DRAFT = '我卡在一个开源项目的第三步，整整两天。后来我做了个U盘，把整套环境预装进去，插上就能跑。结果卖了六千多单。我没卖课，也没收徒。';

describe('SCRIPT_TITLES prompt', () => {
  it('把稿子原文交给模型，而不是只给主题', () => {
    const msg = SCRIPT_TITLES.buildUserMessage({ topic: '开源U盘', narration: DRAFT });
    const text = msg.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('插上就能跑');
  });

  it('禁止编造稿子里没有的事', () => {
    const p = SCRIPT_TITLES.buildSystemPrompt();
    expect(p).toContain('稿子里没有的');
  });

  it('禁止把收益数字写进标题', () => {
    const p = SCRIPT_TITLES.buildSystemPrompt();
    expect(p).toMatch(/收益|变现|赚/);
  });
});

describe('ScriptTitlesResponseSchema', () => {
  it('要 3 个标题和一组话题标签', () => {
    const ok = ScriptTitlesResponseSchema.safeParse({
      titles: [
        { text: '我卡了两天，然后做了个U盘', hookType: '悬念' },
        { text: '一个U盘解决的环境地狱', hookType: '反差' },
        { text: '别人装两天，我插上就跑', hookType: '反差' },
      ],
      tags: ['AI工具', '开源'],
    });
    expect(ok.success).toBe(true);
  });

  it('标题不足 3 个不收', () => {
    const bad = ScriptTitlesResponseSchema.safeParse({
      titles: [{ text: '只有一个标题啊啊', hookType: '悬念' }],
      tags: ['AI'],
    });
    expect(bad.success).toBe(false);
  });
});

describe('checkTitleGrounding', () => {
  it('标题里的数字在稿子里有，就算落地', () => {
    const r = checkTitleGrounding(DRAFT, '卡了两天之后做的那个U盘');
    expect(r.grounded).toBe(true);
    expect(r.inventedNumbers).toEqual([]);
  });

  it('标题里出现稿子里没有的数字，判为编造', () => {
    const r = checkTitleGrounding(DRAFT, '30天卖出6000单的U盘');
    expect(r.grounded).toBe(false);
    expect(r.inventedNumbers).toContain('30');
  });

  it('中文数字也算 —— 模型常把「六千」写成「6000」的反向也一样', () => {
    const r = checkTitleGrounding(DRAFT, '两天做出来的U盘');
    expect(r.grounded).toBe(true);
  });

  it('没有数字的标题永远算落地', () => {
    expect(checkTitleGrounding(DRAFT, '一个U盘的故事').grounded).toBe(true);
  });
});
