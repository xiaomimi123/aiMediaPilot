'use client';

import React from 'react';
import { Player } from '@remotion/player';
// 跨目录 import 独立子项目组件——Task 0 spike 已验证解析可行(打包层面走
// webpack 就近解析规则就能找到, 真正的坎是运行时模块实例, 已经用
// `next.config.js` 的 webpack alias 解决, 见那段顶部注释)。
import { Film, type FilmInput } from '../../../remotion/src/Film';

/**
 * 剪辑台预览封装(三十二期 Task 5)。
 *
 * 两种模式:
 * - `mode="shot"`: 只把选中的一镜交给 Player, **时间轴归零**——`Film` 内部
 *   按 `shots[].startMs/endMs` 算 `Sequence` 的 `from`, 如果原样传绝对时间
 *   (比如这一镜是全片第 3~7 秒), Player 会从第 0 帧开始播、卡片要等到
 *   第 3 秒才出现, 中间是空白——不归零会让"单镜预览"看起来像卡了几秒。
 * - `mode="film"`: 全部镜按原始时间轴 + 音频路由(Task 4 的 Range 静态路由),
 *   Player 自己的进度条即可 seek。
 *
 * **降级**: `Film`/`Player` 初始化或渲染抛错时(React error boundary 兜底),
 * 回落到已有的 `shot-still` 静态卡面接口 + 一行说明——剪辑台是本期的脸面,
 * 不能让 Player 的任何运行时问题连累整页白屏。
 */

/** 与 `remotion/src/cards/style.ts` 的 `ShotStyle` 逐字段同形——独立子项目,
 * 不 import(同一惯例见 `Film.tsx`/`shot-plan.ts` 里 `FilmShotStyle` 的注释)。*/
export type PreviewShotStyle = {
  speed?: number;
  accent?: 'default' | 'blue' | 'yellow' | 'red';
  scale?: number;
};

export type PreviewShot = {
  shotId: string;
  startMs: number;
  endMs: number;
  card: string;
  slots: Record<string, unknown>;
  style?: PreviewShotStyle;
};

export interface PreviewPlan {
  shots: PreviewShot[];
}

export interface PlanPreviewProps {
  mode: 'shot' | 'film';
  plan: PreviewPlan;
  /** 选中的镜索引——`mode="film"` 时不影响画面, 只用于降级态展示哪张静态卡面。 */
  selected: number;
  vpId: string;
  aspect: '16:9' | '9:16';
  visualStyle: 'card' | 'illustration';
  /** 预览用帧率, 默认 30——与 `remotion/src/Root.tsx` Studio 默认 Composition 一致。
   * 调用方可传更低的值(如 worker preview 链用的 15)换取更流畅的实时交互。 */
  fps?: number;
  /**
   * 模板级默认样式(三十六期 Task 3/5)——与逐镜 `PreviewShot.style` 合并的
   * 唯一输入口子, 合并发生在 `Film.tsx` 渲卡处。可选, 没有模板或模板未配置
   * 时传 `null`/不传, 与 `film-plan` GET 返回的 `templateStyle` 字段同形。
   */
  templateStyle?: PreviewShotStyle | null;
}

const DEFAULT_FPS = 30;

/** 16:9/9:16 两种画幅的合成尺寸——与 `remotion/src/Root.tsx` 两个 `Composition` 一致。 */
const COMPOSITION_SIZE: Record<'16:9' | '9:16', { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
};

/**
 * `PreviewShot.card` 是宽松的 `string`(剪辑台本地编辑态不强绑 `CARDS` 的字面量
 * 联合, 理由见 `film-plan-workbench.tsx` 的 `LocalShot` 注释), 而 `FilmInput`
 * 要求 `keyof typeof CARDS`——两边同形但字面量宽窄不同, 断言一次收敛, 不为了
 * 这一层宽松额外重复定义一份严格类型。
 */
function buildInputProps(props: PlanPreviewProps): { inputProps: FilmInput; durationInFrames: number; fps: number } {
  const fps = props.fps ?? DEFAULT_FPS;
  const { mode, plan, selected, vpId, aspect, visualStyle, templateStyle } = props;

  // captions 两种模式都硬编码 []——不是本期漏做, 是范围局限: `FilmPlan`/
  // `PreviewPlan` 这层编辑态数据结构本来就不携带字幕, 字幕是渲染阶段由
  // `src/lib/video-production/align-captions.ts` 基于最终音频做时间对齐才
  // 生成的产物, 编辑台此刻拿不到; 已有的静态卡面缓存
  // (`src/lib/video-production/shot-still-cache.ts`)同理也是 `captions: []`。
  // 所以这里预览"看不到字幕"是已知且预期的展示局限, 不是 bug。

  if (mode === 'shot') {
    const shot = plan.shots[selected];
    const durMs = shot.endMs - shot.startMs;
    // 时间轴归零——见组件顶部注释, 这是"单镜预览"能立刻出画面而不是空播几秒的关键。
    const normalized: PreviewShot = { ...shot, startMs: 0, endMs: durMs };
    return {
      inputProps: {
        shots: [normalized] as unknown as FilmInput['shots'],
        audioSrc: null,
        bgm: null,
        captions: [],
        aspect,
        visualStyle,
        sourceVideo: null,
        templateStyle: templateStyle ?? undefined,
      },
      durationInFrames: Math.max(1, Math.ceil((durMs / 1000) * fps)),
      fps,
    };
  }

  const totalMs = plan.shots.reduce((max, s) => Math.max(max, s.endMs), 0);
  return {
    inputProps: {
      shots: plan.shots as unknown as FilmInput['shots'],
      audioSrc: `/api/v1/cockpit/video-productions/${vpId}/audio`,
      bgm: null,
      captions: [],
      aspect,
      visualStyle,
      sourceVideo: null,
      templateStyle: templateStyle ?? undefined,
    },
    durationInFrames: Math.max(1, Math.ceil((totalMs / 1000) * fps)),
    fps,
  };
}

/** 降级态——已有的 `shot-still` 静态卡面接口, 不是新造的接口。 */
function StaticFallback({ vpId, shotIndex }: { vpId: string; shotIndex: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- 服务端裁的 PNG, 降级用途无需 next/image */}
      <img
        src={`/api/v1/cockpit/video-productions/${vpId}/shot-still/${shotIndex}`}
        alt="静态卡面预览"
        className="max-h-64 w-auto rounded border border-border bg-background"
      />
      <p className="text-xs text-muted-foreground">实时预览不可用，显示静态卡面</p>
    </div>
  );
}

interface BoundaryState {
  hasError: boolean;
}

/**
 * React error boundary——只有 class 组件能实现, 靠 `getDerivedStateFromError`
 * 兜底。**边界很窄, 读的人务必留意**: React error boundary 只能接住"渲染期
 * 同步抛错"(比如 `Film` 组件本身在 render 阶段抛异常)。
 *
 * 真机复测证实(三十二期 Task 5 复审): 音频 404、解码失败这类**最可能真实
 * 发生**的故障, 是 `<audio>` 元素内部异步触发的 `error`/`stalled` 事件,
 * 根本不经过 React 渲染流程, **这层 boundary 完全接不住**——实测复现为
 * `networkState` 卡在 LOADING、`error` 恒为 `null`, UI 上只是"能播但没声音"
 * 或者播放卡死, 不会触发下面这个降级。Remotion 没有提供订阅内部 audio 元素
 * 状态的公开钩子, 去 hack 它的 DOM 句柄成本远大于收益, 本轮不做。
 *
 * 所以这里只覆盖"Player/Film 渲染期同步抛错"这一种故障; 异步的音频故障靠
 * `PlanPreview` 里那个手动的"改用静态卡面"入口兜底(用户自己发现没声音后
 * 点一下, 不是自动检测)。
 */
class PlayerBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console -- 降级路径要留痕, 不能静默吞掉
    console.error('[PlanPreview] Player 渲染失败, 降级到静态卡面', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function PlanPreview(props: PlanPreviewProps) {
  const { mode, plan, selected, vpId, aspect } = props;
  // 手动降级入口(三十二期 Task 5 复审)——音频加载/解码这类异步故障不会
  // 触发 `PlayerBoundary`(见其上方注释), 用户实际看到的是"能播但没声音"
  // 或播放卡死。与其假装能自动检测, 不如给一个显式出路: 用户自己点一下
  // 就切到静态卡面, 不再依赖 Player。
  const [manualFallback, setManualFallback] = React.useState(false);
  if (plan.shots.length === 0) return null;

  const { inputProps, durationInFrames, fps } = buildInputProps(props);
  const { width, height } = COMPOSITION_SIZE[aspect];
  // 降级态展示哪一镜的静态卡面: 单镜模式就是选中那一镜; 整片模式没有"选中镜"
  // 这个概念对画面的影响, 退而求其次展示第一镜。
  const fallbackShotIndex = mode === 'shot' ? selected : 0;

  /**
   * 真机复测踩坑(三十二期 Task 5): Remotion 官方文档明确 `durationInFrames`/
   * `fps`/`compositionWidth`/`compositionHeight` 初始化后不可动态改——实测
   * 复现: 不带 `key` 时, 单镜→整片切换(durationInFrames 从几十帧跳到几千帧)
   * 会让 `<Player>` 内部的 `SharedAudioContextProvider` 处于半新半旧状态:
   * 人声 `<Audio>` 确实 mount 过一次(用 `HTMLMediaElement.prototype.src` 的
   * setter 拦截实测捕获到真实 URL 被赋过值), 但随即被重置回 Remotion 预置的
   * 静音占位 tag、之后再也没有真实音源——整片模式变成"能拖时间轴但永远没声音"。
   * 单镜模式切换选中镜同样会改变 `durationInFrames`(镜长不同), 同一类风险。
   *
   * 修法: 给 `<Player>` 挂一个随"合成级配置"(`durationInFrames`/`fps`/画幅)
   * 变化而变化的 `key`——触发 React 完整卸载重挂, 而不是让 Player 在内部
   * 尝试"原地更新"一份文档警告过不支持动态改的配置。**不能把 `key` 绑到
   * `inputProps` 整体**(那样连改一个 style 参数都会重挂, 播放进度被打断,
   * 违背"改完立刻见效、不中断预览"的核心诉求)——只绑定这四个真正不可变的量。
   *
   * **补一条(复审窄路径)**: `mode` 必须也编进 key。反例: 方案只有一镜且
   * `startMs=0` 时, 单镜模式的 `durMs`(`endMs-startMs`)与整片模式的
   * `totalMs`(`max(endMs)`)数值相等——若 key 不含 mode, 切换模式时 key
   * 不变、Player 不重挂载, 而 `audioSrc` 恰好从 `null` 变成真实 URL, 复现
   * 上面那个"音轨静默丢失"bug。
   */
  const playerKey = `${mode}:${width}x${height}@${fps}:${durationInFrames}`;

  if (manualFallback) {
    return (
      <div className="flex flex-col items-center gap-2">
        <StaticFallback vpId={vpId} shotIndex={fallbackShotIndex} />
        <button
          type="button"
          onClick={() => setManualFallback(false)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          改用实时预览
        </button>
      </div>
    );
  }

  return (
    <PlayerBoundary fallback={<StaticFallback vpId={vpId} shotIndex={fallbackShotIndex} />}>
      <div className="flex flex-col gap-1">
        <Player
          key={playerKey}
          component={Film}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          fps={fps}
          compositionWidth={width}
          compositionHeight={height}
          style={{ width: '100%', aspectRatio: `${width} / ${height}` }}
          controls
          loop
          clickToPlay={false}
        />
        <button
          type="button"
          onClick={() => setManualFallback(true)}
          className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          没声音或卡顿？改用静态卡面
        </button>
      </div>
    </PlayerBoundary>
  );
}
