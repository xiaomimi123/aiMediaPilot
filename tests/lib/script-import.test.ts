import { describe, it, expect } from 'vitest';
import { SCRIPT_IMPORT, checkImportFidelity } from '@/lib/llm/prompts/script-import';
import { ACT_KEYS } from '@/lib/script/six-act';

describe('SCRIPT_IMPORT prompt', () => {
  const sys = SCRIPT_IMPORT.buildSystemPrompt();

  it('**「一个字都不许改」放在最重的位置** —— 模型的默认倾向就是顺手润色', () => {
    expect(sys).toContain('一个字都不许改');
  });

  it('给反例 —— 只说「不要改」模型照样会改', () => {
    expect(sys).toContain('✗');
    expect(sys).toContain('✓');
  });

  it('说明为什么不许改, 不是当规矩背 —— 理由本身就是这个工具的立场', () => {
    expect(sys).toContain('一手体感');
  });

  it('明说不许调顺序、不许删、不许补', () => {
    expect(sys).toContain('调整句子顺序');
    expect(sys).toContain('删掉');
    expect(sys).toContain('补一句');
  });

  it('允许空幕 —— 硬凑一幕会把「这稿子缺一段」这个信息盖住', () => {
    expect(sys).toContain('空着');
  });

  it('输出契约在最后', () => {
    expect(sys.lastIndexOf('JSON')).toBeGreaterThan(sys.length * 0.7);
  });

  it('user message 里再强调一次不许改', () => {
    const parts = SCRIPT_IMPORT.buildUserMessage({ text: '我卡了两天。' });
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('一个字都不要改');
    expect(text).toContain('我卡了两天。');
  });

  it('schema 要求正好六幕', () => {
    const acts = ACT_KEYS.map((act) => ({ act, title: 't', narration: 'x' }));
    expect(SCRIPT_IMPORT.responseSchema.safeParse({ acts, topic: '开源U盘' }).success).toBe(true);
    expect(SCRIPT_IMPORT.responseSchema.safeParse({ acts: acts.slice(0, 5), topic: '开源U盘' }).success).toBe(false);
    // topic 是模型新写的名字, 不能少
    expect(SCRIPT_IMPORT.responseSchema.safeParse({ acts }).success).toBe(false);
  });

  it('schema 允许某一幕台词为空 —— 原文没有那一幕就该空着', () => {
    const acts = ACT_KEYS.map((act, i) => ({ act, title: 't', narration: i === 3 ? '' : 'x' }));
    expect(SCRIPT_IMPORT.responseSchema.safeParse({ acts, topic: '开源U盘' }).success).toBe(true);
  });
});

describe('checkImportFidelity', () => {
  const src = '我卡了两天。装环境、配依赖，每一步都报错。';
  const acts = (...n: string[]) => n.map((narration) => ({ narration }));

  it('原样切分 → 一字未改', () => {
    const r = checkImportFidelity(src, acts('我卡了两天。', '装环境、配依赖，每一步都报错。'));
    expect(r.faithful).toBe(true);
  });

  it('**标点变化不算改字** —— 切分时把一句拆两幕, 标点必然会变', () => {
    const r = checkImportFidelity(src, acts('我卡了两天', '装环境 配依赖 每一步都报错'));
    expect(r.faithful).toBe(true);
  });

  it('**模型偷偷补字要被抓出来** —— 补一个「其实」肉眼根本看不出来', () => {
    const r = checkImportFidelity(src, acts('我其实卡了两天。', '装环境、配依赖，每一步都报错。'));
    expect(r.faithful).toBe(false);
    expect(r.addedChars).toBe(2);
  });

  it('模型删字也要抓出来', () => {
    const r = checkImportFidelity(src, acts('我卡了两天。', '装环境，每一步都报错。'));
    expect(r.faithful).toBe(false);
    expect(r.missingChars).toBeGreaterThan(0);
  });

  it('换词(既删又补)两边都记', () => {
    const r = checkImportFidelity('我卡住了', acts('我卡了'));
    expect(r.missingChars).toBe(1);
    expect(r.addedChars).toBe(0);
  });

  it('空输入不抛', () => {
    expect(checkImportFidelity('', acts()).faithful).toBe(true);
  });
});

describe('导入时的主题', () => {
  it('稿子已经在手里, 主题必须由模型从稿子里起 —— 不该反过来逼用户先想一个', () => {
    const p = SCRIPT_IMPORT.buildSystemPrompt();
    expect(p).toContain('topic');
  });

  it('主题是新写的名字, 不算改字 —— 逐字核对只看 narration', () => {
    const original = '我卡了两天。后来做了个U盘。';
    const acts = ACT_KEYS.map((act, i) => ({
      act, title: '幕', narration: i === 0 ? '我卡了两天。' : i === 1 ? '后来做了个U盘。' : '',
    }));
    expect(checkImportFidelity(original, acts).faithful).toBe(true);
  });
});
