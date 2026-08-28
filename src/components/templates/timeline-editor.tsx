'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildTrack, formatTimecode, pxToMs, sceneAt, totalMs, type TimelineScene,
} from '@/lib/video/timeline';
import {
  SCENE_LAYOUTS, SCENE_LAYOUT_HINTS, SCENE_LAYOUT_LABELS, computeSceneRects, type SceneLayout,
} from '@/lib/video/scene-layout';
import { cn } from '@/lib/utils';

/**
 * 时间线编辑台。
 *
 * 上一版做成了「一镜一镜生成再看」, 那不是编辑台 —— **编辑台的定义是能拖时间线,
 * 停在哪一帧就调哪一帧**。所以这里的中心是播放头: 拖到哪, 预览就 seek 到哪,
 * 右边的面板就切到那一幕。
 *
 * 版面挂在**场景**上而不是模板上, 因为真实口播视频的版面是逐场景在变的: 讲道理时
 * 人物全屏, 摆证据时内容占大半, 演示时录屏铺满、人缩成圆窗。一个全局设置表达不了
 * 这件事。
 *
 * 画面上的框全部来自 `computeSceneRects` —— 和 ffmpeg 用的是同一个函数。编辑台
 * 要么和成片一致, 要么就别画。
 */

export interface EditorScene extends TimelineScene {
  layout: SceneLayout;
  /** 这一幕的 B-roll 预览页(已内联 gsap + 播放器)。没出画面时为空。 */
  previewHtml: string;
  claim: string;
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

export function TimelineEditor({
  scenes,
  captions,
  frame,
  onLayoutChange,
  onSelect,
  captionStyle,
  contentLabel,
}: {
  scenes: EditorScene[];
  captions: CaptionCue[];
  frame: { width: number; height: number };
  onLayoutChange: (sceneId: string, layout: SceneLayout) => void;
  /** 选中项变化时通知外层, 让「3 · 画面」那一块跟着切。 */
  onSelect: (sceneId: string) => void;
  captionStyle: {
    on: boolean;
    fontSize: number;
    marginV: number;
    primaryColor: string;
    outlineColor: string;
    outlineWidth: number;
  };
  /**
   * 内容区没有实时预览时显示的说明。
   *
   * 试做台里内容区放的是 Builder 刚出的 HTML(实时可放); 而真实出片任务的画面
   * 已经渲成 mp4 了, 浏览器里没有那份 HTML —— 这时候画的是**版面框**, 说明文字
   * 得跟着换, 不能还写「这一幕还没出画面」让人以为出错了。
   */
  contentLabel?: string;
}) {
  const total = totalMs(scenes);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const hit = sceneAt(scenes, playhead);
  const scene = (hit?.scene as EditorScene | undefined) ?? null;

  /**
   * **选中项由播放头派生, 不另存一份。**
   *
   * 第一版是两套状态: 点轨道块只改选中、不移播放头, 而版面按钮改的是播放头所在
   * 的那一幕 —— 于是「我选中了第二幕, 点了左内容右人物」实际改的是第一幕。
   * 编辑器里「当前」只能有一个意思。
   */
  const selectedId = scene?.id ?? null;
  useEffect(() => {
    if (selectedId) onSelect(selectedId);
    // onSelect 是外层每次渲染都新建的函数, 进依赖会无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const rects = computeSceneRects(frame, scene?.layout ?? 'content-full');
  const cue = captions.find((c) => playhead >= c.startMs && playhead < c.endMs) ?? null;

  // B-roll 预览页固定 1920×1080, 缩到内容区那一块的大小
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const contentW = rects.content ? (rects.content.width / frame.width) * w : w;
      setScale(contentW / 1920);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rects.content, frame.width]);

  /** 播放头动了就让预览 seek 到场景内的对应时刻 —— 差之毫厘就是调错帧。 */
  useEffect(() => {
    if (!hit) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'preview-seek', t: hit.offsetMs / 1000 },
      '*',
    );
    // 依赖只取 id 和偏移, 不取 hit 对象本身: 它每次渲染都是新对象, 进依赖会让
    // 这个 effect 每帧都发一次 postMessage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.scene.id, hit?.offsetMs]);

  // 播放: 用 rAF 推播放头, 而不是让每个 iframe 自己播 —— 只有一条时间线才对得齐
  useEffect(() => {
    if (!playing || total <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPlayhead((p) => {
        const next = p + dt;
        if (next >= total) { setPlaying(false); return total; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPlayhead(pxToMs(clientX - rect.left, total, rect.width));
    },
    [total],
  );

  // 按住拖动。监听挂在 window 上, 否则鼠标划出轨道就断了 —— 那正是拖动最常发生的事
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => seekFromEvent(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, seekFromEvent]);

  const sceneTrack = buildTrack(scenes, total);
  const captionTrack = buildTrack(
    captions.map((c, i) => ({ id: `c${i}`, startMs: c.startMs, endMs: c.endMs, label: c.text })),
    total,
  );

  const pct = (v: number, axis: 'x' | 'y') =>
    `${(v / (axis === 'x' ? frame.width : frame.height)) * 100}%`;

  return (
    <div className="flex flex-col gap-4">
      {/* 画布 */}
      <div
        ref={stageRef}
        style={{ containerType: 'inline-size', aspectRatio: `${frame.width} / ${frame.height}` }}
        className="relative mx-auto w-full max-w-md overflow-hidden rounded-md border border-border bg-black"
      >
        {/* 内容(B-roll)块 */}
        {rects.content && scene?.previewHtml ? (
          <div
            className="absolute overflow-hidden"
            style={{
              left: pct(rects.content.x, 'x'),
              top: pct(rects.content.y, 'y'),
              width: pct(rects.content.width, 'x'),
              height: pct(rects.content.height, 'y'),
            }}
          >
            <iframe
              ref={iframeRef}
              key={scene.id}
              srcDoc={scene.previewHtml}
              title="内容预览"
              sandbox="allow-scripts"
              style={{
                width: 1920,
                height: 1080,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                border: 0,
              }}
              className="absolute left-0 top-0"
            />
          </div>
        ) : rects.content ? (
          <div
            className="absolute flex items-center justify-center bg-secondary/20 text-center text-[10px] leading-relaxed text-muted-foreground"
            style={{
              left: pct(rects.content.x, 'x'),
              top: pct(rects.content.y, 'y'),
              width: pct(rects.content.width, 'x'),
              height: pct(rects.content.height, 'y'),
            }}
          >
            {contentLabel ?? '这一幕还没出画面'}
          </div>
        ) : null}

        {/* 口播块。真视频还没接进来, 画的是占位框 —— 位置和尺寸是真的 */}
        {rects.person ? (
          <div
            className={cn(
              'absolute flex items-center justify-center border-2 border-dashed border-white/60 bg-white/10 text-[10px] text-white/80',
              rects.personCircle ? 'rounded-full' : 'rounded-sm',
            )}
            style={{
              left: pct(rects.person.x, 'x'),
              top: pct(rects.person.y, 'y'),
              width: pct(rects.person.width, 'x'),
              height: pct(rects.person.height, 'y'),
            }}
          >
            口播
          </div>
        ) : null}

        {/* 字幕。位置字号和 ffmpeg 烧的一致 */}
        {captionStyle.on && cue ? (
          <div
            className="pointer-events-none absolute left-0 right-0 flex justify-center px-[3.7%]"
            style={{ bottom: pct(captionStyle.marginV, 'y') }}
          >
            <span
              className="text-center leading-tight"
              style={{
                fontSize: `${(captionStyle.fontSize / frame.width) * 100}cqw`,
                color: captionStyle.primaryColor,
                WebkitTextStroke: `${(captionStyle.outlineWidth / frame.width) * 100}cqw ${captionStyle.outlineColor}`,
                paintOrder: 'stroke fill',
              }}
            >
              {cue.text}
            </span>
          </div>
        ) : null}
      </div>

      {/* 走带 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="rounded-md border border-foreground bg-primary px-4 py-1.5 text-xs text-primary-foreground"
        >
          {playing ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          onClick={() => { setPlaying(false); setPlayhead(0); }}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          回到开头
        </button>
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatTimecode(playhead)} / {formatTimecode(total)}
        </span>
        {scene ? (
          <span className="text-xs text-muted-foreground">
            当前：{scene.label} · {SCENE_LAYOUT_LABELS[scene.layout]}
          </span>
        ) : null}
      </div>

      {/* 时间线 */}
      <div className="select-none">
        <div
          ref={trackRef}
          onMouseDown={(e) => { setPlaying(false); setDragging(true); seekFromEvent(e.clientX); }}
          className="relative cursor-ew-resize rounded-md border border-border bg-card p-2"
        >
          <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            场景 {scenes.length}
          </p>
          <div className="relative h-8">
            {sceneTrack.map((b) => {
              const s = scenes.find((x) => x.id === b.id)!;
              return (
                <button
                  key={b.id}
                  type="button"
                  // 点块 = 把播放头挪到这一幕的开头。选中项跟着播放头走,
                  // 所以这一步同时完成了「选中」
                  onClick={(e) => { e.stopPropagation(); setPlaying(false); setPlayhead(s.startMs); }}
                  style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                  className={cn(
                    'absolute top-0 h-full overflow-hidden truncate rounded-sm border px-1.5 text-left text-[0.65rem] transition-colors',
                    selectedId === b.id
                      ? 'border-foreground bg-primary text-primary-foreground'
                      : 'border-border bg-secondary/70 hover:border-foreground/40',
                  )}
                  title={`${s.label} · ${SCENE_LAYOUT_LABELS[s.layout]}`}
                >
                  {b.label}
                </button>
              );
            })}
          </div>

          <p className="mb-1 mt-2 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            字幕 {captions.length}
          </p>
          <div className="relative h-5">
            {captionTrack.map((b) => (
              <div
                key={b.id}
                style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                className="absolute top-0 h-full overflow-hidden truncate rounded-sm bg-foreground/15 px-1 text-[0.6rem] text-muted-foreground"
                title={b.label}
              >
                {b.label}
              </div>
            ))}
          </div>

          {/* 播放头。pointer-events-none 让它不挡住下面的块 */}
          <div
            className="pointer-events-none absolute bottom-2 top-2 w-px bg-destructive"
            style={{ left: `calc(${total > 0 ? (playhead / total) * 100 : 0}% )` }}
          >
            <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          按住拖动时间线，预览会跟着停在那一刻。点场景块选中它，右边就切到那一幕。
        </p>
      </div>

      {/* 版面模式 —— 逐场景 */}
      {scene ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            这一幕的版面
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SCENE_LAYOUTS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLayoutChange(scene.id, l)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  scene.layout === l
                    ? 'border-foreground bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
                )}
              >
                {SCENE_LAYOUT_LABELS[l]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {SCENE_LAYOUT_HINTS[scene.layout]}
          </p>
        </div>
      ) : null}
    </div>
  );
}
