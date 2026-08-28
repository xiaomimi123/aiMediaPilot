import { describe, it, expect } from 'vitest';
import { OVERLAY_PLAN, sanitizeOverlayItems } from '@/lib/llm/prompts/overlay-plan';

describe('OVERLAY_PLAN prompt', () => {
  const sys = OVERLAY_PLAN.buildSystemPrompt();

  it('**明令禁止把字幕原句抄成关键词** —— 那样同一句话出现两次, 大的还盖住脸', () => {
    expect(sys).toContain('绝不把字幕原句抄成关键词');
    expect(sys).toContain('盖住脸');
  });

  it('说清楚全片不切镜 —— 模型默认会去想分镜', () => {
    expect(sys).toContain('不切镜');
    expect(sys).toContain('没有 B-roll');
  });

  it('限制一屏同时出现的元素数 —— 堆满五格人就没了', () => {
    expect(sys).toContain('最多 3 个');
  });

  it('说明关键词要停留到这一段讲完, 不是闪一下', () => {
    expect(sys).toContain('停留到');
  });

  it('输出契约在最后', () => {
    expect(sys.lastIndexOf('JSON')).toBeGreaterThan(sys.length * 0.7);
  });

  it('user message 带毫秒时间轴 —— 没有时间轴模型只能瞎猜时刻', () => {
    const parts = OVERLAY_PLAN.buildUserMessage({
      segments: [{ startMs: 0, endMs: 2400, text: '我卡在第三步' }],
      durationMs: 147000,
    });
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('[0~2400] 我卡在第三步');
    expect(text).toContain('147 秒');
  });

  it('schema 限关键词长度 —— 长了就是第二份字幕', () => {
    const ok = { items: [{ kind: 'keyword', text: '用内容', slot: 'left-1', startMs: 0, endMs: 1000 }] };
    expect(OVERLAY_PLAN.responseSchema.safeParse(ok).success).toBe(true);
    const long = { items: [{ ...ok.items[0], text: '这是一句非常长的话根本不是关键词' }] };
    expect(OVERLAY_PLAN.responseSchema.safeParse(long).success).toBe(false);
  });

  it('schema 拒绝未知槽位和未知类型', () => {
    const base = { kind: 'keyword', text: 'x', slot: 'left-1', startMs: 0, endMs: 1 };
    expect(OVERLAY_PLAN.responseSchema.safeParse({ items: [{ ...base, slot: 'middle' }] }).success).toBe(false);
    expect(OVERLAY_PLAN.responseSchema.safeParse({ items: [{ ...base, kind: 'emoji' }] }).success).toBe(false);
  });
});

describe('sanitizeOverlayItems', () => {
  const it0 = (over: Partial<{ kind: string; text: string; slot: string; startMs: number; endMs: number }> = {}) => ({
    kind: 'keyword', text: '用内容', slot: 'left-1', startMs: 0, endMs: 3000, ...over,
  });

  it('**同一格时间重叠的丢掉后来的** —— 叠在一起会糊成一团', () => {
    const r = sanitizeOverlayItems(
      [it0({ startMs: 0, endMs: 3000 }), it0({ text: '别的', startMs: 1000, endMs: 4000 })],
      10000,
    );
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('用内容');
  });

  it('不同格可以同时出现', () => {
    const r = sanitizeOverlayItems(
      [it0({ slot: 'left-1' }), it0({ text: '别的', slot: 'left-3' })],
      10000,
    );
    expect(r).toHaveLength(2);
  });

  it('**抄了字幕原句的丢掉** —— schema 只能限长度, 限不住「这就是那句话」', () => {
    const r = sanitizeOverlayItems([it0({ text: '我卡在第三步' })], 10000, ['我卡在第三步。']);
    expect(r).toEqual([]);
  });

  it('标点不同也算抄 —— 模型常常只是去掉句号', () => {
    const r = sanitizeOverlayItems([it0({ text: '我卡在第三步' })], 10000, ['我卡在第三步，']);
    expect(r).toEqual([]);
  });

  it('箭头不受抄袭判定影响 —— 它没有语义文字', () => {
    const r = sanitizeOverlayItems([it0({ kind: 'arrow', text: '' })], 10000, ['']);
    expect(r).toHaveLength(1);
  });

  it('超出片长的截断到片尾, 完全在片长之外的丢掉', () => {
    const r = sanitizeOverlayItems([it0({ startMs: 8000, endMs: 99000 })], 10000);
    expect(r[0].endMs).toBe(10000);
    expect(sanitizeOverlayItems([it0({ startMs: 20000, endMs: 30000 })], 10000)).toEqual([]);
  });

  it('零长或倒置直接丢', () => {
    expect(sanitizeOverlayItems([it0({ startMs: 5000, endMs: 5000 })], 10000)).toEqual([]);
    expect(sanitizeOverlayItems([it0({ startMs: 5000, endMs: 1000 })], 10000)).toEqual([]);
  });

  it('空输入返回空, 不抛', () => {
    expect(sanitizeOverlayItems([], 10000)).toEqual([]);
  });
});
