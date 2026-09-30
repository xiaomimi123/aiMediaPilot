import { describe, expect, it, vi } from 'vitest';
import { buildScoreMessage, scoreMap, scoreScript, ScoreSchema, SCORE_SYSTEM } from '@/lib/predict/score';

const five = ['hook', 'pace', 'ending', 'interaction', 'topic'].map((dim, i) => ({ dim, score: i + 1, reason: 'r', quote: '', segmentId: null, fix: '' }));

describe('predict scoring', () => {
  it('accepts exactly five distinct dimensions', () => {
    expect(ScoreSchema.safeParse({ scores: five }).success).toBe(true);
    expect(ScoreSchema.safeParse({ scores: five.slice(0, 4) }).success).toBe(false);
    expect(ScoreSchema.safeParse({ scores: [...five.slice(0, 4), { ...five[0] }] }).success).toBe(false);
    expect(ScoreSchema.safeParse({ scores: five.map((s) => ({ ...s, score: 6 })) }).success).toBe(false);
  });
  it('builds a blind message from the script only', () => {
    const m = buildScoreMessage({ segments: [{ id: 's1', label: '开场钩子', text: '一个 U 盘能卖到第一？', estSec: 6 }], transcript: null, persona: '定位：真实', benchmark: '选题：小品类' });
    expect(m).toContain('[s1] 开场钩子（约 6 秒）\n一个 U 盘能卖到第一？');
    expect(m).toContain('【账号定位】\n定位：真实');
    expect(m).toContain('【对标拆解】\n选题：小品类');
    expect(m).not.toMatch(/播放|点赞数|完播率 \d/);
  });
  it('uses the transcript when given', () => {
    expect(buildScoreMessage({ segments: null, transcript: ['第一句', '第二句'], persona: '', benchmark: '' })).toContain('【实际口播（逐句）】\n第一句\n第二句');
  });
  it('explains the scale and the Douyin signals in the system prompt', () => {
    expect(SCORE_SYSTEM).toContain('2 秒');
    expect(SCORE_SYSTEM).toContain('只输出 JSON');
  });
  it('calls the model once and maps scores', async () => {
    const llm = { callStructured: vi.fn(async () => ({ result: { scores: five }, usage: {} })) };
    const s = await scoreScript(llm as never, { segments: null, transcript: ['x'], persona: '', benchmark: '' });
    expect(llm.callStructured).toHaveBeenCalledTimes(1);
    expect(scoreMap(s)).toEqual({ hook: 1, pace: 2, ending: 3, interaction: 4, topic: 5 });
  });
});
