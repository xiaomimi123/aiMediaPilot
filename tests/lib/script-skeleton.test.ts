import { describe, it, expect } from 'vitest';
import { SCRIPT_SKELETON, skeletonToActs } from '@/lib/llm/prompts/script-skeleton';
import { ACT_KEYS } from '@/lib/script/six-act';

const RES = {
  thesis: '免费的东西不一定便宜，装不上就等于没有',
  questions: ['你当时最崩溃的是哪一刻？', '为什么忍了那么久才想到要解决它？'],
  acts: ACT_KEYS.map((act) => ({
    act,
    title: `${act} 标题`,
    guide: `这一幕要完成的动作是${act}`,
    beats: ['关键词一', '关键词二'],
    materialNeeds: act === 'hook' ? ['一个具体的失败细节，带数字更好'] : [],
  })),
};

describe('SCRIPT_SKELETON prompt', () => {
  it('系统提示里把「不写台词」放在最重的位置', () => {
    const sys = SCRIPT_SKELETON.buildSystemPrompt('ai-knowledge', '', '');
    expect(sys).toContain('不要写任何可以直接念出口的句子');
    // 反例必须给出来 —— 只说「不要写台词」模型照样会写
    expect(sys).toContain('✗');
  });

  it('明令禁止把研究材料写成使用者的经历 —— 真机上编过一次人生', () => {
    const sys = SCRIPT_SKELETON.buildSystemPrompt('ai-knowledge', '', '');
    expect(sys).toContain('绝不断言使用者有什么材料');
    expect(sys).toContain('研究材料是第三方信息');
  });

  it('素材库为空时明说不许断言 —— 空着比编着强', () => {
    const parts = SCRIPT_SKELETON.buildUserMessage({
      topic: 't', durationSec: 60, actSeconds: {}, materials: [],
    });
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('我的素材: 空');
    expect(text).toContain('不许断言');
  });

  it('有素材时列出来并标明只有这些是本人真有的', () => {
    const parts = SCRIPT_SKELETON.buildUserMessage({
      topic: 't', durationSec: 60, actSeconds: {},
      materials: [{ kind: 'experience', content: '我卡在第三步' }],
    });
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('只有这些是使用者本人真有的');
    expect(text).toContain('我卡在第三步');
  });

  it('输出契约仍在最后 —— 前面加的约束不能把它挤走', () => {
    const sys = SCRIPT_SKELETON.buildSystemPrompt('ai-knowledge', '', '');
    expect(sys.lastIndexOf('JSON')).toBeGreaterThan(sys.length * 0.7);
  });

  it('user message 带上各幕时长预算', () => {
    const parts = SCRIPT_SKELETON.buildUserMessage({
      topic: '装不上的开源项目',
      durationSec: 60,
      actSeconds: { hook: 6, concept_a: 13 },
    });
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('装不上的开源项目');
    expect(text).toContain('6 秒');
    expect(text).toContain('不写台词');
    expect(text).toContain('不编他的人生');
  });

  it('schema 要求正好六幕, 少一幕就不合法', () => {
    const short = { ...RES, acts: RES.acts.slice(0, 5) };
    expect(SCRIPT_SKELETON.responseSchema.safeParse(short).success).toBe(false);
    expect(SCRIPT_SKELETON.responseSchema.safeParse(RES).success).toBe(true);
  });

  it('schema 不接受空的 questions —— 写之前要有问题逼出自己的判断', () => {
    expect(
      SCRIPT_SKELETON.responseSchema.safeParse({ ...RES, questions: [] }).success,
    ).toBe(false);
  });
});

describe('skeletonToActs', () => {
  const seconds = Object.fromEntries(ACT_KEYS.map((k, i) => [k, 10 + i]));

  it('**台词一律空串** —— 这是骨架模式的全部意义', () => {
    const acts = skeletonToActs(RES, seconds);
    expect(acts).toHaveLength(6);
    expect(acts.every((a) => a.narration === '')).toBe(true);
  });

  it('guide 放进备注, 写的时候一直看得见', () => {
    const acts = skeletonToActs(RES, seconds);
    expect(acts[0].note).toContain('这一幕要完成的动作是hook');
  });

  it('有材料线索时并进备注, 而不是丢掉', () => {
    const acts = skeletonToActs(RES, seconds);
    expect(acts[0].note).toContain('需要的材料');
    expect(acts[0].note).toContain('带数字更好');
  });

  it('时长按传进来的预算分配', () => {
    const acts = skeletonToActs(RES, seconds);
    expect(acts.find((a) => a.act === 'hook')!.targetSec).toBe(10);
  });

  it('关键词转成六幕稿的 beats 形状, facts 留空等你自己核', () => {
    const acts = skeletonToActs(RES, seconds);
    expect(acts[0].beats).toEqual([{ keyword: '关键词一' }, { keyword: '关键词二' }]);
    expect(acts[0].facts).toEqual([]);
  });
});
