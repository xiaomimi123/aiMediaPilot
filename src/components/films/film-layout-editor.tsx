'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TimelineEditor, type EditorScene, type CaptionCue } from '@/components/templates/timeline-editor';
import type { SceneLayout } from '@/lib/video/scene-layout';

/**
 * 成片的逐场景版面编辑(二十三期)。
 *
 * 和模板试做台里那个编辑台**共用同一个时间线组件**, 但语境不同:
 * - 试做台: 内容区放 Builder 刚出的 HTML, 实时能放
 * - 这里: 画面已经渲成 mp4 了, 浏览器里没有那份 HTML —— 所以内容区画的是**版面框**,
 *   真正的画面看上面的预览播放器
 *
 * **改完必须重做预览才生效。** 直接确认导出的话, 正式渲染会用新版面, 而你看过的
 * 预览是旧版面的 —— 那就等于没预览。所以有未保存/已保存但没重渲的改动时,
 * 「确认导出」按钮旁边会明说这件事。
 */
export function FilmLayoutEditor({
  productionId,
  scenes,
  captions,
  frame,
  initialLayouts,
  editable,
  brollEnabled,
  onNeedsRerender,
}: {
  productionId: string;
  scenes: { shotId: string; startMs: number; endMs: number; claim: string }[];
  captions: CaptionCue[];
  frame: { width: number; height: number };
  initialLayouts: Record<string, SceneLayout>;
  /** 渲染中的任务不许改 —— 改了会让成片混着两种版面。 */
  editable: boolean;
  /** 模板开没开 B-roll。关着时只有「人物全屏」可选, 见 availableLayouts。 */
  brollEnabled?: boolean;
  onNeedsRerender: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [layouts, setLayouts] = useState<Record<string, SceneLayout>>(initialLayouts);
  const [saved, setSaved] = useState<Record<string, SceneLayout>>(initialLayouts);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const dirty = JSON.stringify(layouts) !== JSON.stringify(saved);

  async function save() {
    setBusy('save');
    setError('');
    setNote('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${productionId}/scene-layouts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          layouts: scenes.map((s) => ({ shotId: s.shotId, layout: layouts[s.shotId] ?? fallbackLayout })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '保存失败'); return; }
      setSaved(layouts);
      onNeedsRerender(true);
      setNote('已存。改完版面要重做预览才看得到效果——正式渲染会按新版面来。');
      router.refresh();
    } catch {
      setError('保存失败，请检查网络');
    } finally { setBusy(''); }
  }

  /*
   * 没存过版面时的缺省值也要跟着 B-roll 走。
   * 关掉 B-roll 却缺省成「内容全屏」, 播放头那行会显示一个**根本选不了**的版面 ——
   * 又是界面和管线对不上。
   */
  const fallbackLayout: SceneLayout = brollEnabled === false ? 'person-full' : 'content-full';

  const editorScenes: EditorScene[] = scenes.map((s) => ({
    id: s.shotId,
    startMs: s.startMs,
    endMs: s.endMs,
    label: s.claim.slice(0, 12) || s.shotId,
    claim: s.claim,
    layout: layouts[s.shotId] ?? fallbackLayout,
    previewHtml: '',
  }));

  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold">版面</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        拖时间线选中一幕，切它的版面。画面里的框是<span className="text-foreground">出片时真实的位置</span>——
        和 ffmpeg 合成用的是同一套坐标。真正的画面看上面的预览。
        {editable ? '' : ' 这条任务正在渲染，改版面会让成片混着两种版面，所以现在是只读的。'}
      </p>

      <div className={editable ? 'mt-3' : 'mt-3 pointer-events-none opacity-60'}>
        <TimelineEditor
          scenes={editorScenes}
          captions={captions}
          frame={frame}
          onSelect={() => {}}
          onLayoutChange={(id, l) => setLayouts((m) => ({ ...m, [id]: l }))}
          captionStyle={{
            on: false,
            fontSize: 56,
            marginV: 90,
            primaryColor: '#FFFFFF',
            outlineColor: '#000000',
            outlineWidth: 3,
          }}
          brollEnabled={brollEnabled}
          contentLabel="内容区（真实画面见上方预览）"
        />
      </div>

      {editable ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!dirty || busy !== ''} onClick={() => void save()}>
            {busy === 'save' ? '保存中…' : '存版面'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {dirty ? '有未保存的版面改动' : '已是最新'}
          </span>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}
