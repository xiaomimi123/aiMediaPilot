'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LayoutOverlay, LayoutControls, type LayoutState } from './layout-overlay';
import { TimelineEditor, type EditorScene, type CaptionCue } from './timeline-editor';
import type { SceneLayout } from '@/lib/video/scene-layout';
import { parseSrtCues } from '@/lib/video/timeline';

interface Beat { visibleState: string; development: string }
interface Shot {
  shotId: string;
  startMs: number;
  endMs: number;
  claim: string;
  visualJob: string;
  beats: Beat[];
}
interface Direction { concept: string; palette: string[]; shots: Shot[] }

/**
 * 每一幕的版面与已出的画面。按 shotId 存 —— 重新切分会换掉 shotId, 那时这些就
 * 该失效, 用下标存会把旧版面错配到新场景上。
 */
type SceneState = Record<string, {
  layout: SceneLayout;
  /** Builder 的原始产物, 约 5KB —— 存这个而不是预览页(那份内联了 gsap, 79KB)。 */
  html: string;
}>;

/**
 * 模板试做台。
 *
 * 这一页要解决的是: **调模板效果不该等三分钟**。完整出片是 导演→构建者→无头浏览器
 * 逐帧截图→ffmpeg, 三分多钟; 但管线的中间产物本来就是一个自包含的 HTML 页 ——
 * 浏览器能截它, 当然也能直接放它。所以这里只跑到「构建者」为止, 预览走 iframe。
 *
 * 四步对应管线里真实存在的四个环节, 不是编出来的分步:
 * 文案 → 导演切镜 → 构建者出画面 → iframe 预览。每一步都能改, 改完只重跑它后面的。
 *
 * **草稿存 localStorage**: 这是个试做台不是项目, 不该往库里塞记录; 但刷一下就没了
 * 也不能接受 —— 调一个镜头要来回好几轮。
 */

const STORE_KEY = (id: string) => `mp-studio-${id}`;

export function TemplateStudio({
  templateId,
  templateName,
  builderModel,
  visualStyle,
  visualTone,
  deliveryMode,
  initialLayout,
}: {
  templateId: string;
  templateName: string;
  builderModel: string;
  visualStyle: string;
  visualTone: string;
  deliveryMode: string;
  initialLayout: LayoutState;
}) {
  const [text, setText] = useState('');
  const [direction, setDirection] = useState<Direction | null>(null);
  const [current, setCurrent] = useState(0);
  const [html, setHtml] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');
  const [editingHtml, setEditingHtml] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  /**
   * 把 1920×1080 的页面等比缩到容器宽度。
   *
   * 不做这一步的话, iframe 只是开了一个容器宽度的**窗口**看一张 1920px 宽的页 ——
   * 画面右边直接被切掉, 而且居中的元素看起来是偏右的。第一版就是这样, 界面上写着
   * 「等比缩放」但根本没缩, 是界面在撒谎。
   *
   * 用 ResizeObserver 而不是一次性算: 侧栏折叠、窗口缩放都会改容器宽度。
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1920);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview]);

  // 恢复草稿。放 effect 里而不是 useState 初值 —— 服务端渲染时没有 localStorage,
  // 直接读会让首屏和水合结果对不上。
  //
  // **恢复后自动把预览重新包一次**: 预览页有 79KB(内联了 gsap), 存进 localStorage
  // 太浪费; 而重新包装是纯字符串拼接, 不花模型钱。不自动做的话, 刷新之后 HTML 在、
  // 预览却是空的, 唯一的入口还藏在「直接改 HTML」里 —— 那等于丢了。
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(STORE_KEY(templateId));
      if (!raw) return; // finally 里仍然会 setReady(true)
      const d = JSON.parse(raw);
      if (typeof d.text === 'string') setText(d.text);
      if (d.direction) setDirection(d.direction);
      if (typeof d.srt === 'string') setSrt(d.srt);
      if (typeof d.html === 'string') setHtml(d.html);
      if (d.sceneState && typeof d.sceneState === 'object') {
        setSceneState(d.sceneState);
        setSelectedId(d.direction?.shots?.[0]?.shotId ?? null);
        // 每幕的预览页按需重新包装(纯字符串拼接, 不花模型钱) —— 存 79KB × N 会爆
        void rewrapAll(d.sceneState, d.direction);
      }
    } catch { /* 存坏了就当没有 */ } finally {
      setReady(true);
    }
    // rewrapAll 故意不进依赖: 恢复只能跑一次, 进了依赖会因为函数每次渲染都是新的
    // 而反复重跑, 每次都发 N 个包装请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  /** 只重新包装, 不重跑模型。恢复草稿和手改 HTML 都走这条。 */
  async function rewrapOne(shotOf: Shot, palette: string[], rawHtml: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/v1/video-templates/${templateId}/studio/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shot: shotOf, palette, html: rawHtml }),
      });
      const body = await res.json();
      return res.ok && body?.success ? (body.data.preview as string) : null;
    } catch {
      return null;
    }
  }

  /** 恢复草稿后把每一幕的预览页重新包一次。逐个跑, 不并发 —— 这只是字符串拼接。 */
  async function rewrapAll(st: SceneState, dir: Direction | null) {
    if (!dir) return;
    for (const shotOf of dir.shots) {
      const raw = st[shotOf.shotId]?.html;
      if (!raw) continue;
      const wrapped = await rewrapOne(shotOf, dir.palette, raw);
      if (wrapped) {
        setPreviews((p) => ({ ...p, [shotOf.shotId]: wrapped }));
        // 第一幕顺便填进「4 · 预览」那一块, 保持原来的行为
        if (shotOf.shotId === dir.shots[0]?.shotId) setPreview(wrapped);
      }
    }
  }

  /**
   * **恢复之前绝不保存。**
   *
   * 第一版栽在这: 保存 effect 在首次挂载时就跑了一次, 那时 state 还是空的 ——
   * 它把上一次的草稿整个覆盖成空, 而恢复 effect 读到的已经是被自己清空的值。
   * 症状是「刷新一次草稿就没了」, 但看代码两个 effect 都是对的。
   */
  const [ready, setReady] = useState(false);

  /**
   * 版面(字幕 + 口播小窗)。
   *
   * **不进 localStorage 草稿, 而是直接存回模板** —— 这几项是模板配置的一部分,
   * 出片时真正被消费的是模板里的值。存在草稿里会让「试做台上调好了」和「真出片
   * 用的」变成两回事, 那正是这一页要消灭的东西。
   */
  const [sceneState, setSceneState] = useState<SceneState>({});
  /** shotId → 包装好的预览页。纯派生, 不进草稿 —— 一份 79KB, 存了就爆。 */
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [srt, setSrt] = useState('');
  const [layout, setLayout] = useState<LayoutState>(initialLayout);
  const [savedLayout, setSavedLayout] = useState<LayoutState>(initialLayout);
  const layoutDirty = JSON.stringify(layout) !== JSON.stringify(savedLayout);

  // 成片画面尺寸。真人出镜跟你拍的竖屏走, 其余模式是 Builder 固定的 1920×1080。
  const frame =
    deliveryMode === 'talking-head-broll'
      ? { width: 1080, height: 1920 }
      : { width: 1920, height: 1080 };

  async function saveLayout() {
    setBusy('layout');
    setError('');
    try {
      const res = await fetch(`/api/v1/video-templates/${templateId}/layout`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(layout),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '保存失败'); return; }
      setSavedLayout(layout);
    } catch {
      setError('保存失败，请检查网络');
    } finally { setBusy(''); }
  }
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        STORE_KEY(templateId),
        JSON.stringify({ text, direction, html, srt, sceneState }),
      );
    } catch { /* 满了就算了, 不打扰 */ }
  }, [ready, templateId, text, direction, html, srt, sceneState]);

  const shot = direction?.shots[current] ?? null;

  async function runDirect() {
    setBusy('direct');
    setError('');
    try {
      const res = await fetch(`/api/v1/video-templates/${templateId}/studio/direct`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '切分失败'); return; }
      setDirection(body.data.direction);
      setCurrent(0);
      setSrt(body.data.srt ?? '');
      // 换了分镜, 旧画面和旧版面都对不上了 —— shotId 变了, 留着会错配
      setHtml('');
      setPreview('');
      setSceneState(
        Object.fromEntries(
          (body.data.direction.shots as Shot[]).map((s: Shot) => [
            s.shotId,
            // 默认内容全屏 = 原来的挖空行为, 不擅自替用户改版面
            { layout: 'content-full' as SceneLayout, html: '' },
          ]),
        ),
      );
      setSelectedId(body.data.direction.shots[0]?.shotId ?? null);
    } catch {
      setError('切分失败，请检查网络');
    } finally { setBusy(''); }
  }

  async function runBuild(useExistingHtml = false) {
    if (!shot || !direction) return;
    setBusy('build');
    setError('');
    setWarn('');
    try {
      const res = await fetch(`/api/v1/video-templates/${templateId}/studio/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shot,
          palette: direction.palette,
          ...(useExistingHtml ? { html } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '出画面失败'); return; }
      setHtml(body.data.html);
      setPreview(body.data.preview);
      if (shot) {
        setSceneState((st) => ({
          ...st,
          [shot.shotId]: { layout: st[shot.shotId]?.layout ?? 'content-full', html: body.data.html },
        }));
        setPreviews((p) => ({ ...p, [shot.shotId]: body.data.preview }));
      }
      if (!body.data.gsapInlined) {
        setWarn('这份 HTML 没有按契约引用 gsap.min.js —— 预览能看，但真渲染时会失败。');
      }
    } catch {
      setError('出画面失败，请检查网络');
    } finally { setBusy(''); }
  }

  function patchShot(patch: Partial<Shot>) {
    if (!direction || !shot) return;
    const shots = direction.shots.map((s, i) => (i === current ? { ...s, ...patch } : s));
    setDirection({ ...direction, shots });
  }

  function patchBeat(i: number, patch: Partial<Beat>) {
    if (!shot) return;
    patchShot({ beats: shot.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  }

  return (
    <>
      <p className="mb-5 rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
        这是<span className="font-medium text-foreground">「{templateName}」的试做台</span>：
        只跑到「构建者出 HTML」为止，预览直接在浏览器里放——
        <span className="font-medium text-foreground">不用等三分多钟的完整渲染</span>。
        用的是模板自己的 {builderModel} / {visualStyle} / {visualTone === 'light' ? '亮底' : '暗底'}，
        所以这里调出来的效果，就是真出片时的效果。
        <br />
        一处出入：真出片的时间轴来自录音，这里是按朗读速度估的，镜头时长会有偏差。
      </p>

      {/* 1 文案 */}
      <section className="mb-6">
        <h2 className="text-base font-semibold">1 · 文案</h2>
        <p className="mt-1 text-xs text-muted-foreground">贴一段口播文案。20 字起。</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder="贴一段你想试的文案，或者从稿库里复制一幕过来。"
          className="mt-2 w-full resize-y rounded-md border border-input bg-card p-3.5 text-sm leading-relaxed focus:border-foreground/40 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" disabled={busy !== '' || text.trim().length < 20} onClick={() => void runDirect()}>
            {busy === 'direct' ? '切分中…' : direction ? '重新切分' : '切分成镜头'}
          </Button>
          <span className="text-xs text-muted-foreground">{text.trim().length} 字</span>
        </div>
      </section>

      {/* 2 切分 */}
      {direction ? (
        <section className="mb-6">
          <h2 className="text-base font-semibold">2 · 切分</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            视觉概念：{direction.concept}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {direction.palette.map((c) => (
              <span
                key={c}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                <span className="h-3 w-3 rounded-sm border border-border" style={{ background: c }} />
                {c}
              </span>
            ))}
          </div>

          <ul className="mt-3 flex flex-wrap gap-1.5">
            {direction.shots.map((s, i) => (
              <li key={s.shotId}>
                <button
                  type="button"
                  onClick={() => setCurrent(i)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs tabular-nums transition-colors',
                    i === current
                      ? 'border-foreground bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
                  )}
                >
                  {s.shotId} · {((s.endMs - s.startMs) / 1000).toFixed(1)}s
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 3 画面 */}
      {shot ? (
        <section className="mb-6">
          <h2 className="text-base font-semibold">3 · 画面</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            改完下面任意一项，重新出画面才会生效。
          </p>

          <div className="mt-2 flex flex-col gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">主张</span>
              <input
                value={shot.claim}
                onChange={(e) => patchShot({ claim: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">视觉任务</span>
                <input
                  value={shot.visualJob}
                  onChange={(e) => patchShot({ visualJob: e.target.value })}
                  className="mt-1 w-40 rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">时长（秒）</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={((shot.endMs - shot.startMs) / 1000).toFixed(1)}
                  onChange={(e) =>
                    patchShot({ endMs: shot.startMs + Math.max(500, Number(e.target.value) * 1000) })
                  }
                  className="mt-1 w-28 rounded-md border border-input bg-card px-3 py-2 text-sm tabular-nums focus:border-foreground/40 focus:outline-none"
                />
              </label>
            </div>

            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                微节拍 · {shot.beats.length}
              </span>
              <ul className="mt-1.5 flex flex-col gap-2">
                {shot.beats.map((b, i) => (
                  <li key={i} className="rounded-md border-l-2 border-foreground/25 bg-secondary/45 p-3">
                    <textarea
                      value={b.visibleState}
                      onChange={(e) => patchBeat(i, { visibleState: e.target.value })}
                      rows={2}
                      placeholder="画面变成什么样"
                      className="w-full resize-y bg-transparent text-sm leading-relaxed focus:outline-none"
                    />
                    <textarea
                      value={b.development}
                      onChange={(e) => patchBeat(i, { development: e.target.value })}
                      rows={1}
                      placeholder="这个变化本身是什么"
                      className="mt-1 w-full resize-y bg-transparent text-xs leading-relaxed text-muted-foreground focus:outline-none"
                    />
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={busy !== ''} onClick={() => void runBuild(false)}>
                {busy === 'build' ? '出画面中…' : html ? '重新出画面' : '出画面'}
              </Button>
              {html ? (
                <button
                  type="button"
                  onClick={() => setEditingHtml((v) => !v)}
                  className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {editingHtml ? '收起 HTML' : '直接改 HTML'}
                </button>
              ) : null}
            </div>

            {editingHtml ? (
              <div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  这是渲染时真正用的那份 HTML。改完点「用改后的 HTML 预览」——
                  <span className="text-foreground">不花模型钱</span>。
                </p>
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  className="mt-1.5 w-full resize-y rounded-md border border-input bg-card p-3 font-mono text-xs leading-relaxed focus:border-foreground/40 focus:outline-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy !== ''}
                  onClick={() => void runBuild(true)}
                >
                  用改后的 HTML 预览
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4 编辑台 —— 时间线。它本身就是预览, 不再单独给一块 */}
      {direction ? (
        <section className="mb-6">
          <h2 className="text-base font-semibold">4 · 编辑台</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            拖时间线，停在哪一刻就看哪一刻。点场景块选中它，下面切这一幕的版面——
            <span className="text-foreground">版面是逐场景的</span>，讲道理时人物全屏、
            摆证据时内容占大半、演示时录屏铺满你缩成圆窗。画面上的框和出片时 ffmpeg 叠的是同一套坐标。
          </p>
          <div className="mt-3">
            <TimelineEditor
              scenes={direction.shots.map((s): EditorScene => ({
                id: s.shotId,
                startMs: s.startMs,
                endMs: s.endMs,
                label: s.claim.slice(0, 12) || s.shotId,
                claim: s.claim,
                layout: sceneState[s.shotId]?.layout ?? 'content-full',
                previewHtml: previews[s.shotId] ?? '',
              }))}
              captions={parseSrtCues(srt)}
              frame={frame}
              onSelect={(id) => {
                setSelectedId(id);
                const i = direction.shots.findIndex((s) => s.shotId === id);
                if (i >= 0) setCurrent(i);
              }}
              onLayoutChange={(id, l) =>
                setSceneState((st) => ({
                  ...st,
                  [id]: { layout: l, html: st[id]?.html ?? '' },
                }))
              }
              captionStyle={{
                on: layout.captionOn,
                fontSize: layout.fontSize,
                marginV: layout.marginV,
                primaryColor: layout.primaryColor,
                outlineColor: layout.outlineColor,
                outlineWidth: layout.outlineWidth,
              }}
            />
          </div>
        </section>
      ) : null}

      {/* 5 字幕样式 */}
      {direction ? (
        <section className="mb-6">
          <h2 className="text-base font-semibold">5 · 字幕样式</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            改这里，上面编辑台里的字幕会跟着变——用的是 ffmpeg 烧字幕时的同一套坐标算法。
            字号是<span className="text-foreground">画面像素</span>，不是抽象档位。
            这几项是<span className="text-foreground">模板配置</span>，存回模板后出片直接生效。
          </p>
          <div className="mt-3">
            <LayoutControls
              state={layout}
              onChange={(patch) => setLayout({ ...layout, ...patch })}
              frame={frame}
              // 口播位置改成逐场景选(编辑台里的版面模式), 不再是模板级的四角小窗
              showPip={false}
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" disabled={!layoutDirty || busy !== ''} onClick={() => void saveLayout()}>
              {busy === 'layout' ? '保存中…' : '存回模板'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {layoutDirty ? '有未保存的版面改动' : '已存回模板'}
            </span>
          </div>
        </section>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </>
  );
}
