import { describe, expect, it } from 'vitest';
import { buildTeleprompterScript, estimateActSpeed } from '@/lib/cockpit/teleprompter';

const ACTS = [
  { act: 'hook', title: '开场钩子', narration: '我用 6 个小时做了个东西，卖了 6000 多单。', targetSec: 15 },
  { act: 'concept_a', title: '这东西是什么', narration: '东西很简单，一个 U 盘，插上就能用。', targetSec: 20 },
];

describe('buildTeleprompterScript', () => {
  it('没有六幕稿时返回空 —— 页面据此给引导而不是空白', () => {
    expect(buildTeleprompterScript([])).toEqual([]);
  });

  it('逐幕产出, 保留台词原文', () => {
    const rows = buildTeleprompterScript(ACTS);
    expect(rows).toHaveLength(2);
    expect(rows[0].narration).toContain('6000 多单');
  });

  it('带上幕标题与目标秒数, 录的时候能对节奏', () => {
    const [a] = buildTeleprompterScript(ACTS);
    expect(a.title).toBe('开场钩子');
    expect(a.targetSec).toBe(15);
  });

  it('累计起止时间 —— 知道这一幕该在第几秒开始', () => {
    const rows = buildTeleprompterScript(ACTS);
    expect(rows[0].startSec).toBe(0);
    expect(rows[1].startSec).toBe(15);
  });

  it('台词按句拆分, 提词器一行一句更好念', () => {
    const rows = buildTeleprompterScript([
      { act: 'hook', title: 'x', narration: '第一句。第二句！第三句？', targetSec: 10 },
    ]);
    expect(rows[0].lines).toEqual(['第一句。', '第二句！', '第三句？']);
  });

  it('空台词的幕不产出空行', () => {
    const rows = buildTeleprompterScript([
      { act: 'hook', title: 'x', narration: '   ', targetSec: 5 },
    ]);
    expect(rows[0].lines).toEqual([]);
  });
});

describe('estimateActSpeed', () => {
  it('按字数与目标秒数算出该用的语速(字/秒)', () => {
    // 30 字 / 10 秒 = 3 字每秒
    expect(estimateActSpeed('一二三四五六七八九十'.repeat(3), 10)).toBeCloseTo(3, 1);
  });

  it('目标秒数为 0 时不除零', () => {
    expect(Number.isFinite(estimateActSpeed('一二三', 0))).toBe(true);
  });

  it('空台词返回 0', () => {
    expect(estimateActSpeed('', 10)).toBe(0);
  });

  it('中文口播的合理语速区间约 4~6 字/秒 —— 超出时页面可以提示', () => {
    // 90 字 / 15 秒 = 6 字每秒, 偏快但仍在区间内
    expect(estimateActSpeed('字'.repeat(90), 15)).toBe(6);
  });
});
