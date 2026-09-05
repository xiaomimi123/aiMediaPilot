// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PlanPreview } from '@/components/films/plan-preview';

// Player 在 jsdom 里跑不了真渲染, mock 掉只验 props 契约。
// 额外用一个 mount 计数器验证"key 变了会不会真的触发 React 重新挂载"——
// `useState` 的惰性初始化只在 mount 时跑一次, key 不变时组件是同一个 fiber
// 实例, 计数器不会再往前走; key 变了 React 卸载旧实例、挂载新实例, 计数器
// 才会推进。这比直接读 `key` prop 更可靠(`key` 是 React 保留字段, 不会出现
// 在函数组件收到的 props 里)。
import { useState } from 'react';
const playerProps: Record<string, unknown>[] = [];
let mountCounter = 0;
vi.mock('@remotion/player', () => ({
  Player: (p: Record<string, unknown>) => {
    const instanceId = useState(() => ++mountCounter)[0];
    playerProps.push({ ...p, __instanceId: instanceId });
    return <div data-testid="player" />;
  },
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

  it('单镜方案(一镜、startMs=0)在 shot/film 两种 mode 下 durationInFrames 相同, 切换 mode 仍必须触发 Player 重挂载 —— 否则 Player 不重挂载, 音轨从 null 静默变成真实 URL', () => {
    // 单镜且 startMs=0: 单镜模式的 durMs(=endMs-startMs)与整片模式的 totalMs
    // (=max(endMs))数值相等, 是复审推导出的窄路径复现条件——这种情况下如果
    // playerKey 不含 mode, key 不会变, React 不会重挂载 Player。
    const singleShotPlan = { shots: [
      { shotId: 's1', startMs: 0, endMs: 3000, card: 'statement', slots: { text: '一' } },
    ] };

    playerProps.length = 0;
    const { rerender } = render(
      <PlanPreview mode="shot" plan={singleShotPlan as never} selected={0} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />,
    );
    const shotProps = playerProps.at(-1)!;

    rerender(
      <PlanPreview mode="film" plan={singleShotPlan as never} selected={0} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />,
    );
    const filmProps = playerProps.at(-1)!;

    // 前提断言: durationInFrames 确实相同(否则这条窄路径没有意义)。
    expect(shotProps.durationInFrames).toBe(filmProps.durationInFrames);
    // 真正要守住的断言: mount 计数器必须推进, 说明 React 真的重挂载了 Player,
    // 而不是在原地更新 audioSrc 这类不该动态改的 prop。
    expect(filmProps.__instanceId).not.toBe(shotProps.__instanceId);
  });
});
