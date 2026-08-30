'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { canStartProduction } from '@/lib/cockpit/production-status';
import {
  PRODUCTION_STAGES, isInFlight, stageHint, stageIndex, waitingOn,
} from '@/lib/cockpit/production-stage';
import { cn } from '@/lib/utils';
import { FilmLayoutEditor } from './film-layout-editor';
import type { SceneLayout } from '@/lib/video/scene-layout';

interface Film {
  id: string;
  title: string;
  mode: string;
  status: string;
  createdAt: string;
  errorMessage: string | null;
  hasPreview: boolean;
  hasMaster: boolean;
  templateName: string | null;
  /** 这条片子是用哪份稿子出的 —— 没有稿子就登记不了发布(登记挂在稿子上)。 */
  scriptDraftId: string | null;
  /** 已登记的发布链接。 */
  publishedUrl: string | null;
  /** 分镜(来自 direction.json)。预览跑完才有 —— 空数组时不显示版面编辑。 */
  scenes: { shotId: string; startMs: number; endMs: number; claim: string }[];
  captions: { startMs: number; endMs: number; text: string }[];
  savedLayouts: Record<string, SceneLayout>;
  frame: { width: number; height: number };
  /** 模板开没开 B-roll。关着时编辑台只给「人物全屏」—— 其余版面没有内容画面可放。 */
  brollEnabled: boolean;
}

/**
 * 成片详情。
 *
 * 这一页存在的理由: 「确认导出」这一步在 v5 重建里连同旧的内容详情页一起被删了,
 * 而 approve 接口和 worker 的 master→packaging→done 分支都还在 —— 结果 9 条任务
 * 全部停在 preview_ready, 界面上只显示一个「预览就绪」, 看不出它是**在等人点一下**。
 *
 * 所以这一页把「等你」摆在最显眼的位置, 而不是只画一条进度条。
 */
export function FilmDetail({ initial }: { initial: Film }) {
  const router = useRouter();
  const [film, setFilm] = useState(initial);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  /**
   * 版面改过但还没按新版面重渲。
   *
   * 这时候直接确认导出的话, 正式渲染会用新版面, 而你看过的预览是旧版面的 ——
   * 等于没预览。所以按钮旁边要明说, 并把「重做预览」摆在前面。
   */
  const [layoutStale, setLayoutStale] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishNote, setPublishNote] = useState('');

  // 在跑的时候才轮询。停在「等你」的状态上轮询是纯粹的浪费 —— 它不会自己动。
  useEffect(() => {
    if (!isInFlight(film.status)) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/cockpit/video-productions/${film.id}`);
        const body = await res.json();
        if (body?.success) {
          const d = body.data.production ?? body.data;
          setFilm((f) => ({
            ...f,
            status: d.status ?? f.status,
            errorMessage: d.errorMessage ?? null,
            hasPreview: Boolean(d.previewPath) || f.hasPreview,
            hasMaster: Boolean(d.masterPath) || f.hasMaster,
          }));
        }
      } catch {
        /* 轮询失败不打扰, 下一轮再说 */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [film.id, film.status]);

  async function post(path: string, label: string) {
    setBusy(label);
    setError('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${film.id}${path}`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '操作失败');
        return;
      }
      setFilm((f) => ({ ...f, status: body.data?.status ?? f.status }));
      router.refresh();
    } catch {
      setError('操作失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  /**
   * 发布登记。放在这一页, 是因为这里就是你刚把片子下载下来的那一刻 —— 发完抖音
   * 顺手把链接贴回来, 是整条回路最省事的接法。
   *
   * 贴链接不只是记一笔: 链接里带作品 id, 回采回来的作品也带同一个 id, 两边一对
   * 就自动关联上了, 省掉去数据页逐条认领。刚发的片子通常还没被回采到(每晚 20:00
   * 一轮), 那时候如实说「等今晚」, 不假装成功。
   */
  async function registerPublish() {
    if (!film.scriptDraftId) return;
    setBusy('publish');
    setError('');
    setPublishNote('');
    try {
      const res = await fetch(`/api/v1/scripts/${film.scriptDraftId}/distributions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'douyin', url: publishUrl.trim(), note: null }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '登记失败');
        return;
      }
      setFilm((f) => ({ ...f, publishedUrl: publishUrl.trim() }));
      setPublishUrl('');
      setPublishNote(
        body.data.link === 'linked'
          ? '已登记，并自动关联到回采作品——去校准页能看到这条配对了。'
          : body.data.link === 'already-linked'
            ? '已登记。那条作品之前已经认领过别的稿子，没有覆盖。'
            : body.data.link === 'not-collected-yet'
              ? '已登记。这条还没被回采到，今晚 20:00 那轮会自动关联上。'
              : '已登记。这个链接里没有作品 id（短链要跳转才知道是哪条），到数据页手动认领一下。',
      );
    } catch {
      setError('登记失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  const idx = stageIndex(film.status);
  const failed = film.status === 'failed';
  const wait = waitingOn(film.status);

  return (
    <>
      {/* 「下一步等谁」放在最上面。这一条就是这页存在的理由。 */}
      <div
        className={cn(
          'mb-6 rounded-md border-l-2 px-4 py-3',
          failed
            ? 'border-destructive/70 bg-destructive/[0.06]'
            : wait === 'you'
              ? 'border-foreground/50 bg-secondary/60'
              : 'border-border bg-card',
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {failed ? '失败' : wait === 'you' ? '等你' : wait === 'machine' ? '在跑' : '完成'}
        </p>
        <p className="mt-1 text-sm leading-relaxed">{stageHint(film.status)}</p>
        {film.errorMessage ? (
          <p className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-destructive">
            {film.errorMessage}
          </p>
        ) : null}
      </div>

      {/* failed 不画进度 —— 把失败画成"进行到某一步"是在美化它 */}
      {!failed ? (
        <ol className="mb-6 flex flex-wrap gap-x-1 gap-y-2">
          {PRODUCTION_STAGES.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1">
              <span
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  i < idx
                    ? 'text-muted-foreground'
                    : i === idx
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground/40',
                )}
              >
                {s.label}
              </span>
              {i < PRODUCTION_STAGES.length - 1 ? (
                <span className="text-xs text-muted-foreground/30">›</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {film.hasPreview || film.hasMaster ? (
        <section className="mb-6">
          <h2 className="text-base font-semibold">
            {film.hasMaster ? '成片' : '预览'}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {film.hasMaster
              ? '正式成片，已按模板加过字幕、BGM 和片头片尾。'
              : '预览片。分辨率和码率都是低的，只用来判断内容对不对——确认导出之后才渲染正式版。'}
          </p>
          {/* key 让换源时播放器真的重载, 否则会继续放旧文件 */}
          <video
            key={film.hasMaster ? 'master' : 'preview'}
            controls
            className="mt-3 w-full max-w-2xl rounded-md border border-border bg-black"
            src={`/api/v1/cockpit/video-productions/${film.id}/file?kind=${film.hasMaster ? 'master' : 'preview'}`}
          />
        </section>
      ) : null}

      {film.scenes.length > 0 ? (
        <FilmLayoutEditor
          productionId={film.id}
          scenes={film.scenes}
          captions={film.captions}
          frame={film.frame}
          initialLayouts={film.savedLayouts}
          editable={waitingOn(film.status) === 'you'}
          brollEnabled={film.brollEnabled}
          onNeedsRerender={setLayoutStale}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {layoutStale && film.status === 'preview_ready' ? (
          <Button variant="outline" disabled={busy !== ''} onClick={() => void post('/recompose', 'recompose')}>
            {busy === 'recompose' ? '合成中…' : '按新版面重新合成'}
          </Button>
        ) : null}

        {film.status === 'preview_ready' ? (
          <Button disabled={busy !== ''} onClick={() => void post('/approve', 'approve')}>
            {busy === 'approve' ? '提交中…' : '确认导出'}
          </Button>
        ) : null}

        {layoutStale && film.status === 'preview_ready' ? (
          <span className="text-xs text-destructive">
            版面改过但还没重渲——现在导出的话，成片会是新版面，而你看过的预览是旧的。
          </span>
        ) : null}

        {canStartProduction(film.status) ? (
          <Button variant="outline" disabled={busy !== ''} onClick={() => void post('/start', 'start')}>
            {busy === 'start' ? '启动中…' : failed ? '重新制作' : '开始制作'}
          </Button>
        ) : null}

        {film.hasMaster ? (
          <a
            href={`/api/v1/cockpit/video-productions/${film.id}/file?kind=master`}
            download={`${film.title || 'film'}.mp4`}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            下载成片
          </a>
        ) : null}

        <span className="ml-auto text-xs text-muted-foreground">
          {film.mode}
          {film.templateName ? ` · 模板：${film.templateName}` : ' · 无模板（跳过包装）'}
          {' · '}
          {film.createdAt}
        </span>
      </div>

      {/* 出片之后的最后一环: 发完抖音把链接贴回来, 回路才闭得上 */}
      {film.status === 'done' ? (
        <section className="mt-6 rounded-md border border-border bg-card p-4">
          <h2 className="text-base font-semibold">发布登记</h2>
          {film.publishedUrl ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              已登记：
              <a
                href={film.publishedUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 break-all underline underline-offset-4"
              >
                {film.publishedUrl}
              </a>
            </p>
          ) : !film.scriptDraftId ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              这条片子没有关联的稿子，登记挂不上——发布登记是记在稿子上的。
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                发到抖音之后，把作品链接贴回来。链接里带作品 id，回采时会自动和这份稿子对上——
                <span className="text-foreground">校准要的就是这个配对</span>。
                短链（v.douyin.com/…）抽不出 id，用完整链接。
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={publishUrl}
                  onChange={(e) => setPublishUrl(e.target.value)}
                  placeholder="https://www.douyin.com/video/…"
                  className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                />
                <Button
                  disabled={busy !== '' || !/^https?:\/\//.test(publishUrl.trim())}
                  onClick={() => void registerPublish()}
                >
                  {busy === 'publish' ? '登记中…' : '登记'}
                </Button>
              </div>
            </>
          )}
          {publishNote ? <p className="mt-2 text-xs text-muted-foreground">{publishNote}</p> : null}
        </section>
      ) : null}

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </>
  );
}
