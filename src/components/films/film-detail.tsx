'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { canStartProduction } from '@/lib/cockpit/production-status';
import {
  PRODUCTION_STAGES, isInFlight, stageHint, stageIndex, waitingOn,
} from '@/lib/cockpit/production-stage';
import { cn } from '@/lib/utils';

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

      <div className="flex flex-wrap items-center gap-2">
        {film.status === 'preview_ready' ? (
          <Button disabled={busy !== ''} onClick={() => void post('/approve', 'approve')}>
            {busy === 'approve' ? '提交中…' : '确认导出'}
          </Button>
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

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </>
  );
}
