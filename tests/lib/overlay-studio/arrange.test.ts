import { describe, it, expect } from 'vitest';
import { describeArrangementIssues } from '@/lib/overlay-studio/arrangement';
import { buildOverlayArrangement, MAX_ARRANGE_REPAIR_ROUNDS } from '@/lib/overlay-studio/arrange';

/*
 * Overlay Studio 编排构建器(2026-09-20)。
 * 纪律与 film-plan-builder 测试同源: 假 LLM 按序吐答案 + 记录喂回内容;
 * lint 注入假实现 —— 真 lint 是外部仓库的 CLI, 单测不碰它(集成验证走真机)。
 */

const segs = [
  { startSec: 0, endSec: 5, text: '这个U盘让我干到了第一' },
  { startSec: 5, endSec: 10, text: '先说背景' },
];

const goodDoc = {
  version: 1,
  theme: 'dark',
  cards: [
    { id: 'card-1', kind: 'blur-text', start: 0.5, end: 5, params: { text: '干到*第一*', position: 'center' } },
  ],
};

const fakeLLM = (responses: unknown[]) => {
  const remaining = [...responses];
  const seen: string[] = [];
  return {
    seen,
    callStructured: async (opts: { userMessage: Array<{ text?: string }> }) => {
      seen.push(opts.userMessage.map((p) => p.text ?? '').join('\n'));
      const next = remaining.shift();
      if (next === undefined) throw new Error('假 LLM 被多调了一次');
      return { result: next, usage: {} };
    },
  };
};

const lintOk = async () => ({ ok: true, errors: [], warns: [] });

describe('describeArrangementIssues: 结构报错带实际值', () => {
  it('臆造参数字段 → 指名卡号/kind/字段名, 并列出该卡合法字段', () => {
    const text = describeArrangementIssues({
      version: 1, theme: 'dark',
      cards: [{ id: 'card-1', kind: 'punch-pill', start: 1, end: 3, params: { text: '好', fontSize: 88 } }],
    }).join('\n');
    expect(text).toContain('card-1');
    expect(text).toContain('fontSize');
    expect(text).toContain('text, position'); // 合法字段清单
  });

  it('end 不晚于 start / id 重复 都报得出具体值', () => {
    const text = describeArrangementIssues({
      version: 1, theme: 'dark',
      cards: [
        { id: 'card-1', kind: 'punch-pill', start: 5, end: 5, params: { text: '好' } },
        { id: 'card-1', kind: 'blur-text', start: 6, end: 8, params: { text: '好' } },
      ],
    }).join('\n');
    expect(text).toContain('end=5');
    expect(text).toContain('重复');
  });

  it('未知 kind 被拦', () => {
    const text = describeArrangementIssues({
      version: 1, theme: 'dark',
      cards: [{ id: 'card-1', kind: 'magic-card', start: 1, end: 3, params: {} }],
    }).join('\n');
    expect(text).toContain('kind');
  });
});

describe('buildOverlayArrangement', () => {
  it('一次就对: 不重试, lint 也过', async () => {
    const llm = fakeLLM([goodDoc]);
    const r = await buildOverlayArrangement({ llm: llm as never, segments: segs, durationSec: 10, runLint: lintOk });
    expect(r.rounds).toBe(0);
    expect(r.arrangement.cards).toHaveLength(1);
  });

  it('结构错误喂回修复, 且每轮都带原始逐句稿(防失忆重写)', async () => {
    const bad = { ...goodDoc, cards: [{ id: 'card-1', kind: 'punch-pill', start: 1, end: 3, params: { fontSize: 9, text: '好' } }] };
    const llm = fakeLLM([bad, goodDoc]);
    const r = await buildOverlayArrangement({ llm: llm as never, segments: segs, durationSec: 10, runLint: lintOk });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('fontSize');           // 修复指令
    expect(llm.seen[1]).toContain('这个U盘让我干到了第一'); // 原稿仍在
  });

  it('lint error 也进修复循环, warn 不拦只透传', async () => {
    const lintOnce = (() => {
      let n = 0;
      return async () => (n++ === 0
        ? { ok: false, errors: ['❌ [time-bounds] 「card-1」end=99 超过视频时长 10s'], warns: [] }
        : { ok: true, errors: [], warns: ['⚠️ [caption-track] 先确认原片没有烧录字幕'] });
    })();
    const llm = fakeLLM([goodDoc, goodDoc]);
    const r = await buildOverlayArrangement({ llm: llm as never, segments: segs, durationSec: 10, runLint: lintOnce });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('time-bounds');
    expect(r.warns).toHaveLength(1);
  });

  it(`修 ${MAX_ARRANGE_REPAIR_ROUNDS} 轮仍不合格 → 明确失败并带最后一轮问题`, async () => {
    const bad = { ...goodDoc, cards: [{ id: 'card-1', kind: 'nope', start: 1, end: 3, params: {} }] };
    const llm = fakeLLM([bad, bad, bad]);
    await expect(
      buildOverlayArrangement({ llm: llm as never, segments: segs, durationSec: 10, runLint: lintOk }),
    ).rejects.toThrow(/仍不合格/);
  });
});

describe('列表参数归一(真机首跑的教训: 模型爱写数组, Studio 要分隔串)', () => {
  it('items 数组自动归一成竖线串, chips 数组归一成换行串 —— 不进修复循环', async () => {
    const doc = {
      version: 1, theme: 'dark',
      cards: [
        { id: 'card-1', kind: 'pin-board', start: 0, end: 5, params: { items: ['甲', '乙', '丙'], title: '要点' } },
        { id: 'card-2', kind: 'entity-chips', start: 5, end: 9, params: { chips: ['light|A|a', 'dark|B|b'] } },
      ],
    };
    const llm = fakeLLM([doc]);
    const r = await buildOverlayArrangement({ llm: llm as never, segments: segs, durationSec: 10, runLint: lintOk });
    expect(r.rounds).toBe(0);
    expect(r.arrangement.cards[0].params.items).toBe('甲|乙|丙');
    expect(r.arrangement.cards[1].params.chips).toBe('light|A|a\ndark|B|b');
  });

  it('嵌套对象救不了 → 报错带实际值, 不再是 Invalid input', () => {
    const text = describeArrangementIssues({
      version: 1, theme: 'dark',
      cards: [{ id: 'card-1', kind: 'pin-board', start: 0, end: 5, params: { items: [{ text: '甲' }] } }],
    }).join('\n');
    expect(text).toContain('card-1');
    expect(text).toContain('{"text":"甲"}');
    expect(text).toContain('分隔符字符串');
    expect(text).not.toContain('Invalid input');
  });
});
