'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { canStartProduction } from '@/lib/cockpit/production-status';
import { isRemotionReadyMode } from '@/lib/video-production/renderer';
import {
  PRODUCTION_STAGES, isInFlight, stageHint, stageIndex, waitingOn,
} from '@/lib/cockpit/production-stage';
import { cn } from '@/lib/utils';
import { FilmLayoutEditor } from './film-layout-editor';
import type { SceneLayout } from '@/lib/video/scene-layout';
import type { FreezeReport } from '@/lib/video/freeze-check';

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
  /** 出片后量到的整片静止情况。**null = 没量过**(出在这道关接线之前), 不是 0。 */
  freezeReport: FreezeReport | null;
  /** 这条任务走哪条渲染链 —— 'remotion' 是带人声的新链, 'legacy' 是老链。 */
  renderer: string;
  /** 面向用户的非失败提醒(如"本条为无声成片")。null = 没有要说的话。 */
  productionNotice: string | null;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 画面活跃度 —— 出片后 ffmpeg 量出来的「有多少时长画面纹丝不动」。
 *
 * 为什么值得占界面上一块: 这一维**肉眼在编辑台里看不出来**。四道画面关都是逐帧判的,
 * 每一帧都合格的片子可以整整二十秒是死的; 而真实数据是, 接这道关之前三条交付链的
 * 静止占比分别是 77% / 86% / 94% —— 基本上是在做 PPT。
 *
 * 三条显示上的取舍:
 * - **null 显示「没量过」而不是 0%**。「没测过」和「测过是 0」是两件事, 混起来就是
 *   界面在撒谎 —— 这个项目里已经栽过一次(空壳色块用占比刷分)。
 * - **不通过时把最坏几段做成可点的时间戳**, 点了直接跳到播放器那一刻。只报一个百分比
 *   等于让用户自己去 3 分钟片子里找, 那他就不会去找。
 * - **通过时也显示数字**, 不是只在失败时才出现。一个只在坏的时候才说话的指标, 你无从
 *   判断它到底有没有在跑 —— freeze-check 本身就当过一阵子谁也没调用的死代码。
 */
function FreezePanel({
  report, onSeek,
}: {
  report: FreezeReport | null;
  onSeek: (sec: number) => void;
}) {
  if (!report) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        画面活跃度：<span className="text-muted-foreground/70">没量过</span>{' '}
        —— 这条片子出在这道检查接线之前。重做一次预览就会量。
      </p>
    );
  }

  const pct = Math.round(report.ratio * 100);
  return (
    <div
      className={cn(
        'mt-3 rounded-md border p-3 text-xs',
        report.ok ? 'border-border bg-card' : 'border-destructive/50 bg-destructive/5',
      )}
    >
      <p className="font-medium">
        画面活跃度：{report.ok ? '正常' : '有大段死画面'}
        <span className="ml-2 font-normal text-muted-foreground">
          静止 {report.frozenSec.toFixed(1)}s / {report.totalSec.toFixed(1)}s（{pct}%，{report.count} 段）
        </span>
      </p>
      {report.ok ? (
        <p className="mt-1 text-muted-foreground">
          {report.kind === 'master' ? '正式成片' : '预览片'}整片扫过一遍，没有长时间不动的画面。
        </p>
      ) : (
        <>
          <p className="mt-1 text-muted-foreground">
            画面有大段时间纹丝不动。点时间戳直接跳过去看：
          </p>
          <p className="mt-2 flex flex-wrap gap-2">
            {report.worst.map((seg) => (
              <button
                key={seg.startSec}
                type="button"
                onClick={() => onSeek(seg.startSec)}
                className="rounded border border-border bg-background px-2 py-1 font-mono hover:border-foreground/50"
              >
                {mmss(seg.startSec)} 起 {seg.durationSec.toFixed(1)}s
              </button>
            ))}
          </p>
        </>
      )}
    </div>
  );
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
  // 静止段时间戳点了要跳到播放器那一刻 —— 只报百分比等于让人自己去几分钟片子里找
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
            // 出片跑完那一刻页面是靠轮询更新的, 不接回来就得手动刷新才看得到体检结果
            freezeReport: d.freezeReport ?? f.freezeReport,
            productionNotice: d.productionNotice ?? f.productionNotice,
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
   * 切换渲染方式(「新版渲染」/「旧版渲染」)。只在还没开工时才会被调用——按钮本身
   * 就只在 `canStartProduction` 时渲染, 这里不重复判断。
   *
   * 切换会把服务端的 filmPlan/alignedActs 一并清空, 界面上没有对应展示, 不用额外处理;
   * 但状态得整条刷新(不只是改 renderer 一个字段), 万一以后加了依赖这两个字段的展示,
   * 别悄悄留着一份看起来还有效的旧数据。
   */
  async function switchRenderer(next: 'remotion' | 'legacy') {
    setBusy('renderer');
    setError('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${film.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ renderer: next }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '切换失败');
        return;
      }
      setFilm((f) => ({ ...f, renderer: body.data?.renderer ?? next }));
      router.refresh();
    } catch {
      setError('切换失败，请检查网络');
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
      {/*
        **状态与进度合成一块。** 拆开时它们在说同一件事却各占一份边距: 实测状态区三块
        (页面副标题 + 等你卡 + 阶段条)共 293px, 而视口 771px —— 38% 的首屏在重复
        「这条片子停在预览就绪、等你确认导出」, 把真正要看的画面和它的毛病推到折叠线以下。
        合并之后徽标、那一句话、阶段条在同一张卡里, 读一次就够。
      */}
      <div
        data-testid="film-status"
        className={cn(
          'mb-6 rounded-md border-l-2 px-4 py-3',
          failed
            ? 'border-destructive/70 bg-destructive/[0.06]'
            : wait === 'you'
              ? 'border-foreground/50 bg-secondary/60'
              : 'border-border bg-card',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {failed ? '失败' : wait === 'you' ? '等你' : wait === 'machine' ? '在跑' : '完成'}
          </p>
          <p className="text-sm leading-relaxed">{stageHint(film.status)}</p>
        </div>

        {film.errorMessage ? (
          <p className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-destructive">
            {film.errorMessage}
          </p>
        ) : null}

        {/* failed 不画进度 —— 把失败画成"进行到某一步"是在美化它 */}
        {!failed ? (
          <ol className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
            {PRODUCTION_STAGES.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs',
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
      </div>

      {/*
        **这一页原来是 3.17 屏, 主操作在 2400px 处。** 量出来的三条毛病:
        ①编辑台那块示意画布按宽度约束, 9:16 被撑到 504x896 —— 一块示意图占满一屏还多,
        右边 558px 全空; ②页面上下叠着两个竖屏画面(真播放器 + 示意画布), 看的人
        分不清哪个是真的; ③「确认导出」——这一页存在的理由——要滚三屏才够得着。
        中途试过把播放器和编辑台切成页面级两栏, 真机上更糟: 左栏到底只有一半高、
        空出一大片, 而时间线被挤到 400px 宽, 场景块每块只剩一个字。**时间线要宽度、
        画布要高度, 这两个诉求正交**, 所以并排要发生在编辑台内部(画布 | 版面选项,
        时间线整宽在下), 页面本身保持单列。
      */}
      <div className="mb-6 flex flex-col gap-6">
        {film.hasPreview || film.hasMaster ? (
          <section>
            <h2 className="text-base font-semibold">
              {film.hasMaster ? '成片' : '预览'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {film.hasMaster
                ? '正式成片，已按模板加过字幕、BGM 和片头片尾。'
                : '预览片。分辨率和码率都是低的，只用来判断内容对不对——确认导出之后才渲染正式版。'}
            </p>
            {/*
              播放器与体检面板并排, 放不下自动换行(flex-wrap)。竖屏成片的播放器只有
              260px 宽, 右边会空出 800px —— 而横屏的有 820px 宽, 旁边就塞不下了。
              让它按画幅自己决定, 比给两个画幅各写一套规则可靠。
            */}
            <div className="mt-3 flex flex-wrap items-start gap-4">
            {/* key 让换源时播放器真的重载, 否则会继续放旧文件 */}
            <video
              key={film.hasMaster ? 'master' : 'preview'}
              ref={videoRef}
              controls
              // 竖屏成片的播放器同样会顶得很高, 按视口封顶
              /*
               * **按高度封顶, 宽度让给画幅。** 用 `w-full` 的话竖屏成片会被拉成一个
               * 满宽的盒子, 画面在里面居中、两边全是黑边; 而且不封高的话 9:16 在
               * 1062px 宽的正文里能顶到 1800px 以上, 又把主操作推出视口。
               *
               * 45vh 是**算出来的**, 不是调出来的: 横屏 1920x1080 在 45vh(=347px, 视口 771)
               * 下宽 617px, 加 16px gap 加面板最低 272px = 905px, 装得进正文宽 1062px ——
               * 于是活跃度面板能贴在播放器右边、留在首屏里。50vh 时播放器 685px 宽,
               * 三者相加 1043px 装不下, 面板就换行掉到折叠线以下(实测 y=429)。
               *
               * aspectRatio 直接给成片的真实画幅(服务端已经探过, 版面框也用同一份) ——
               * 不给的话, 元数据到位之前 `w-auto` 只有 300x150 的默认盒子, 加载完再
               * 跳成正确尺寸, 页面明显闪一下; 而视频加载失败时会一直停在那个小盒子。
               */
              style={{ aspectRatio: `${film.frame.width} / ${film.frame.height}` }}
              className="max-h-[45vh] w-auto max-w-full shrink-0 rounded-md border border-border bg-black"
              src={`/api/v1/cockpit/video-productions/${film.id}/file?kind=${film.hasMaster ? 'master' : 'preview'}`}
            />
            <div className="min-w-[17rem] max-w-2xl flex-1">
            <FreezePanel
              report={film.freezeReport}
              onSeek={(sec) => {
                const v = videoRef.current;
                if (!v) return;
                v.currentTime = sec;
                // 跳过去还得让它动起来, 否则停在那一帧 —— 而「静止的画面」和「暂停」
                // 肉眼分不出来, 用户会以为跳转没生效
                void v.play().catch(() => {});
                v.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />
            </div>
            </div>
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
      </div>

      {/*
        主操作贴在视口底。改之前它跟在编辑台后面, 落在 2400px 处 —— 一条 3.17 屏的
        页面上, 「确认导出」这个**这一页存在的理由**要滚到底才看得见。
        贴底之后它永远在手边, 而且「版面改过还没重渲」这句警告跟着它一起被看见 ——
        那句话正是要在按下去之前读到的。
      */}
      <div className="sticky bottom-0 z-10 -mx-10 mt-2 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-10 py-3 backdrop-blur">
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

        {/*
          渲染方式徽标 + 切换。只在任务还没开工(canStartProduction)时给切换按钮——
          处理中/已完成的任务改这个没有意义, 也回不了头(素材/中间产物已经按旧方式走了)。

          复审补(二十九期 Task 2 收尾): 切换按钮还要求 mode 在 isRemotionReadyMode
          清单里——不然会出现「标签显示新版渲染, 实际仍走旧管线出片」的误导: 之前
          这里只按 canStartProduction 显隐, talking-head-broll 这类还没迁完
          Remotion handler 的 mode 也能被切成 'remotion', 徽标改了但 worker
          dispatch 接不住, 会落回旧链——标签与行为不一致。延续本文件"不可用即隐藏"
          的既有模式: 未迁移的 mode 直接不显示切换按钮, 而不是显示了再让用户点了
          碰壁(服务端 PATCH 路由也拦着这个组合, 这里是双保险)。
        */}
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-medium',
            film.renderer === 'remotion'
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground',
          )}
        >
          {film.renderer === 'remotion' ? '新版渲染' : '旧版渲染'}
        </span>
        {canStartProduction(film.status) && isRemotionReadyMode(film.mode) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== ''}
            onClick={() => void switchRenderer(film.renderer === 'remotion' ? 'legacy' : 'remotion')}
          >
            {busy === 'renderer'
              ? '切换中…'
              : film.renderer === 'remotion'
                ? '切换到旧版渲染'
                : '切换到新版渲染'}
          </Button>
        ) : null}

        {/*
          无声降级提醒(二十八期终审)。之前只有 worker 日志知道, 用户点开一条没声音
          的成片会以为是 bug。有值才显示——有声路径/legacy 路径这个字段是 null。
        */}
        {film.productionNotice ? (
          <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-xs text-muted-foreground">
            {film.productionNotice}
          </span>
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
