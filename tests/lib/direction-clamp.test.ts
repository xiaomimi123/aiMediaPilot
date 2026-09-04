import { describe, it, expect } from 'vitest';
import { clampShotsToSource } from '@/lib/video-production/shot-clamp';

const shots = (spans: [number, number][]) =>
  spans.map(([a, b], i) => ({ shotId: `s${i + 1}`, startMs: a, endMs: b, claim: '', visualJob: '', beats: [] }));

describe('clampShotsToSource', () => {
  it('分镜没超时就原样放行', () => {
    const s = shots([[0, 12000], [12000, 40000]]);
    expect(clampShotsToSource(s, 40000)).toHaveLength(2);
  });

  it('整段落在素材之外的镜头直接丢掉 —— 那里没有人声, 注定是无声填充', () => {
    const s = shots([[0, 12000], [155000, 195000], [195000, 234000]]);
    const r = clampShotsToSource(s, 155200);
    expect(r).toHaveLength(1);
    expect(r[0].shotId).toBe('s1');
  });

  it('跨过末尾的镜头裁到素材长度, 不丢内容', () => {
    const r = clampShotsToSource(shots([[140000, 234000]]), 155200);
    expect(r).toHaveLength(1);
    expect(r[0].endMs).toBe(155200);
  });

  it('裁完短到没意义的(不足 1 秒)也丢掉', () => {
    expect(clampShotsToSource(shots([[155000, 234000]]), 155200)).toHaveLength(0);
  });

  it('拿不到素材时长就不动它 —— 宁可不裁, 也不要凭空裁错', () => {
    const s = shots([[0, 12000], [155000, 234000]]);
    expect(clampShotsToSource(s, 0)).toHaveLength(2);
    expect(clampShotsToSource(s, undefined)).toHaveLength(2);
  });
});
