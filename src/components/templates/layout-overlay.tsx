'use client';

import { computePipRect, PIP_POSITIONS, PIP_POSITION_LABELS, PIP_SCALE_MAX, PIP_SCALE_MIN, type PipPosition } from '@/lib/video/pip-layout';
import { cn } from '@/lib/utils';

export interface LayoutState {
  captionOn: boolean;
  fontSize: number;
  marginV: number;
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  pipOn: boolean;
  pipPosition: PipPosition;
  pipScale: number;
  pipMargin: number;
}

/**
 * 版面叠加层 —— 把字幕和口播小窗按**真实成片坐标**画在预览之上。
 *
 * 这一层能成立的前提是字幕字号终于有确定含义了: ASS 头原本没有 `PlayResX/PlayResY`,
 * libass 按默认的 384×288 解释字号再拉伸到成片尺寸 —— 竖屏上等于放大 6.67 倍。
 * 真机第一条成片的字幕就是每个字 250px 高、左右溢出画面的巨字。补上 PlayRes 之后,
 * 字号 56 就是画面上的 56 像素, 这里才可能画得准。
 *
 * 所以这个叠加层用的是**和 ffmpeg 完全相同的算法**: 字幕按 Alignment=2(底部居中)
 * 和 MarginV 定位, 小窗调用 `computePipRect` —— 就是滤镜参数用的那个函数。
 * 预览要么和成片一致, 要么就别画。
 */
export function LayoutOverlay({
  frame,
  state,
  sampleText,
}: {
  /** 成片画面尺寸。竖屏 1080×1920, 横屏 1920×1080。 */
  frame: { width: number; height: number };
  state: LayoutState;
  sampleText: string;
}) {
  const pip = computePipRect(frame, frame, {
    position: state.pipPosition,
    scale: state.pipScale,
    margin: state.pipMargin,
  });

  // 百分比定位, 让叠加层跟着容器一起缩放 —— 容器宽度会随窗口变
  const pctX = (v: number) => `${(v / frame.width) * 100}%`;
  const pctY = (v: number) => `${(v / frame.height) * 100}%`;

  return (
    <div className="pointer-events-none absolute inset-0">
      {state.pipOn ? (
        <div
          className="absolute border-2 border-dashed border-white/70 bg-white/10"
          style={{
            left: pctX(pip.x),
            top: pctY(pip.y),
            width: pctX(pip.width),
            height: pctY(pip.height),
          }}
        >
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">
            口播 {pip.width}×{pip.height}
          </span>
        </div>
      ) : null}

      {state.captionOn ? (
        <div
          className="absolute left-0 right-0 flex justify-center px-[3.7%]"
          // MarginV 是从底边算的, 和 ASS 的 Alignment=2 一致
          style={{ bottom: pctY(state.marginV) }}
        >
          <span
            className="text-center leading-tight"
            style={{
              // cqw 让字号跟着容器宽度缩放, 和成片里「字号 / 画面宽度」的比例一致
              fontSize: `${(state.fontSize / frame.width) * 100}cqw`,
              color: state.primaryColor,
              WebkitTextStroke: `${(state.outlineWidth / frame.width) * 100}cqw ${state.outlineColor}`,
              paintOrder: 'stroke fill',
            }}
          >
            {sampleText}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 版面控件。
 *
 * 字号直接给**画面像素**而不是「小/中/大」: 它现在真的是像素了, 给抽象档位反而
 * 让人没法把预览里看到的和模板里存的对上。
 */
export function LayoutControls({
  state,
  onChange,
  frame,
  showPip,
}: {
  state: LayoutState;
  onChange: (patch: Partial<LayoutState>) => void;
  frame: { width: number; height: number };
  /** 只有真人出镜模式有口播小窗。 */
  showPip: boolean;
}) {
  const row = 'flex flex-wrap items-center gap-x-3 gap-y-1';
  const label = 'w-24 shrink-0 text-xs font-medium text-muted-foreground';
  const num = 'w-24 rounded-md border border-input bg-card px-2 py-1.5 text-sm tabular-nums focus:border-foreground/40 focus:outline-none';

  return (
    <div className="flex flex-col gap-3">
      <div className={row}>
        <span className={label}>字幕</span>
        <div className="flex gap-1.5">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => onChange({ captionOn: v })}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs transition-colors',
                state.captionOn === v
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
              )}
            >
              {v ? '烧' : '不烧'}
            </button>
          ))}
        </div>
      </div>

      {state.captionOn ? (
        <>
          <label className={row}>
            <span className={label}>字号</span>
            <input
              type="range"
              min={20}
              max={160}
              value={state.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className="w-56"
            />
            <input
              type="number"
              min={12}
              max={200}
              value={state.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className={num}
            />
            <span className="text-xs text-muted-foreground">
              画面像素（画面宽 {frame.width}）
            </span>
          </label>

          <label className={row}>
            <span className={label}>底边距</span>
            <input
              type="range"
              min={0}
              max={Math.round(frame.height / 3)}
              value={state.marginV}
              onChange={(e) => onChange({ marginV: Number(e.target.value) })}
              className="w-56"
            />
            <input
              type="number"
              min={0}
              max={500}
              value={state.marginV}
              onChange={(e) => onChange({ marginV: Number(e.target.value) })}
              className={num}
            />
          </label>

          <div className={row}>
            <span className={label}>颜色 / 描边</span>
            <input
              type="color"
              value={state.primaryColor}
              onChange={(e) => onChange({ primaryColor: e.target.value.toUpperCase() })}
              className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-1"
            />
            <input
              type="color"
              value={state.outlineColor}
              onChange={(e) => onChange({ outlineColor: e.target.value.toUpperCase() })}
              className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-1"
            />
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={state.outlineWidth}
              onChange={(e) => onChange({ outlineWidth: Number(e.target.value) })}
              className={num}
            />
          </div>
        </>
      ) : null}

      {showPip ? (
        <>
          <div className={row}>
            <span className={label}>口播画面</span>
            <div className="flex gap-1.5">
              {[
                { v: false, label: '挖空替换' },
                { v: true, label: '画中画' },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => onChange({ pipOn: o.v })}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs transition-colors',
                    state.pipOn === o.v
                      ? 'border-foreground bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {state.pipOn ? 'B-roll 铺满，你缩成小窗——人一直在' : 'B-roll 那几段把你整个替换掉，期间只听得到声音'}
            </span>
          </div>

          {state.pipOn ? (
            <>
              <div className={row}>
                <span className={label}>小窗位置</span>
                <div className="flex gap-1.5">
                  {PIP_POSITIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onChange({ pipPosition: p })}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs transition-colors',
                        state.pipPosition === p
                          ? 'border-foreground bg-primary text-primary-foreground'
                          : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
                      )}
                    >
                      {PIP_POSITION_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              <label className={row}>
                <span className={label}>小窗大小</span>
                <input
                  type="range"
                  min={PIP_SCALE_MIN * 100}
                  max={PIP_SCALE_MAX * 100}
                  value={Math.round(state.pipScale * 100)}
                  onChange={(e) => onChange({ pipScale: Number(e.target.value) / 100 })}
                  className="w-56"
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  占画面宽 {Math.round(state.pipScale * 100)}%
                </span>
              </label>

              <label className={row}>
                <span className={label}>离边缘</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={state.pipMargin}
                  onChange={(e) => onChange({ pipMargin: Number(e.target.value) })}
                  className="w-56"
                />
                <span className="text-xs tabular-nums text-muted-foreground">{state.pipMargin}px</span>
              </label>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
