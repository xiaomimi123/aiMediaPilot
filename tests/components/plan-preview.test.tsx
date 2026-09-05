// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PlanPreview } from '@/components/films/plan-preview';

// Player 在 jsdom 里跑不了真渲染, mock 掉只验 props 契约
const playerProps: Record<string, unknown>[] = [];
vi.mock('@remotion/player', () => ({
  Player: (p: Record<string, unknown>) => { playerProps.push(p); return <div data-testid="player" />; },
}));

const plan = { shots: [
  { shotId: 's1', startMs: 0, endMs: 3000, card: 'statement', slots: { text: '一' } },
  { shotId: 's2', startMs: 3000, endMs: 7000, card: 'statement', slots: { text: '二' } },
] };

describe('PlanPreview', () => {
  it('单镜模式只把选中镜交给 Player, 时长=该镜时长', () => {
    playerProps.length = 0;
    render(<PlanPreview mode="shot" plan={plan as never} selected={1} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const p = playerProps.at(-1)!;
    expect((p.inputProps as { shots: unknown[] }).shots).toHaveLength(1);
    expect(p.durationInFrames).toBe(60); // 4000ms × 15fps / 1000
  });

  it('整片模式给全部镜 + 音频地址', () => {
    playerProps.length = 0;
    render(<PlanPreview mode="film" plan={plan as never} selected={0} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const p = playerProps.at(-1)!;
    const input = p.inputProps as { shots: unknown[]; audioSrc: string | null };
    expect(input.shots).toHaveLength(2);
    expect(input.audioSrc).toContain('/api/v1/cockpit/video-productions/vp1/audio');
  });

  it('单镜模式的分镜时间轴归零 —— Player 从 0 开始播这一镜', () => {
    playerProps.length = 0;
    render(<PlanPreview mode="shot" plan={plan as never} selected={1} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const shots = (playerProps.at(-1)!.inputProps as { shots: {startMs: number; endMs: number}[] }).shots;
    expect(shots[0].startMs).toBe(0);
    expect(shots[0].endMs).toBe(4000);
  });

  it('分镜的 style 参数原样透传给 Player, 不会被时间轴归零逻辑丢弃 —— 改完立刻见效的前提', () => {
    playerProps.length = 0;
    const styledPlan = {
      shots: [
        { shotId: 's1', startMs: 0, endMs: 3000, card: 'statement', slots: { text: '一' }, style: { speed: 1.5, accent: 'blue' as const } },
      ],
    };
    render(<PlanPreview mode="shot" plan={styledPlan as never} selected={0} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const shots = (playerProps.at(-1)!.inputProps as { shots: { style?: { speed?: number; accent?: string } }[] }).shots;
    expect(shots[0].style).toEqual({ speed: 1.5, accent: 'blue' });

    // 换一个 style 值重渲染——Player 收到的 inputProps 应该跟着变(而不是缓存旧值)。
    playerProps.length = 0;
    const changedPlan = {
      shots: [
        { ...styledPlan.shots[0], style: { speed: 0.5, accent: 'red' as const } },
      ],
    };
    render(<PlanPreview mode="shot" plan={changedPlan as never} selected={0} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const shots2 = (playerProps.at(-1)!.inputProps as { shots: { style?: { speed?: number; accent?: string } }[] }).shots;
    expect(shots2[0].style).toEqual({ speed: 0.5, accent: 'red' });
  });
});
