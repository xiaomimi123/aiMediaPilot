import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { pct, humanCount } from '@/lib/works/chart';
import { readActsFromDraftOutput, scoreHardDimensions, isUnwritten } from '@/lib/cockpit/script-score';
import { extractCaptionFeatures } from '@/lib/works/insight';

export const dynamic = 'force-dynamic';

/**
 * 作品详情。
 *
 * 这一页要回答的是「这条为什么是这个结果」, 所以摆的是**能指向下一条怎么改**的
 * 东西: 开头怎么写的、留没留住人、播放来自哪一端、用的是哪份稿子。
 *
 * 有两类数据抖音后台没给, 页面上明说而不是留空: **人群画像**和**流量来源分布**
 * (推荐页/关注页/搜索…)。它们不在 `item_analysis` 这组接口里 —— 编一个出来比
 * 没有更糟。
 */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-2xl font-semibold leading-none tabular-nums">{value}</p>
      {note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export default async function WorkDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();

  const w = await prisma.publishedWork.findUnique({ where: { id } });
  if (!w || w.userId !== user.id) notFound();

  const draft = w.scriptDraftId
    ? await prisma.scriptDraft.findUnique({ where: { id: w.scriptDraftId } })
    : null;
  const acts = draft ? readActsFromDraftOutput(draft.output) : null;
  const scorable = acts !== null && !isUnwritten(acts);
  const hard = scorable ? scoreHardDimensions(acts, acts.reduce((n, a) => n + a.targetSec, 0)) : null;
  const hookAct = acts?.find((a) => a.act === 'hook') ?? null;

  const perClient = (w.playPerClient ?? null) as
    | { douyin_value?: number; xigua_value?: number; yumme_value?: number }
    | null;
  const hashtags = Array.isArray(w.hashtags) ? (w.hashtags as string[]) : [];
  const features = extractCaptionFeatures(w.caption, hashtags);

  // 开头第一句 = 钩子。按标点切, 取第一段有内容的。
  const firstLine = w.caption.split(/[。！？\n!?]/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';

  return (
    <PageShell
      title={w.title || '(无标题)'}
      description={`${w.publishedAt.toISOString().slice(0, 10)} 发布 · ${w.durationSec} 秒${w.isPrivate ? ' · 隐藏/仅自己可见' : ''}`}
      actions={
        <div className="flex gap-3">
          {w.url ? (
            <a
              href={w.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              去抖音看
            </a>
          ) : null}
          <Link
            href="/data"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            回数据
          </Link>
        </div>
      }
    >
      {/* 两个口径并列。挑一个当真相就是在替平台编一个它自己没给的定义。 */}
      <section className="mb-6">
        <h2 className="text-base font-semibold">播放量：两个口径</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Stat
            label="作品列表口径"
            value={humanCount(w.play)}
            note="内容管理页显示的那个数。"
          />
          <Stat
            label="投稿分析口径"
            value={w.anaPlay === null ? '—' : humanCount(w.anaPlay)}
            note={
              w.anaPlay === null
                ? '这条不在分析窗口（近 90 天）里，拿不到。'
                : '后台「投稿分析」里的数，通常比列表口径小得多。'
            }
          />
        </div>
        {w.anaPlay !== null && w.anaPlay !== w.play ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            两个数差 {humanCount(Math.abs(w.play - w.anaPlay))}。抖音没说明哪个是曝光、哪个是有效播放，
            所以都摆着——<span className="text-foreground">跨作品比较时用同一个口径就行</span>，别混着看。
          </p>
        ) : null}
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold">留没留住人</h2>
        {w.completionRate5s === null ? (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            这条没有完播数据——投稿分析只覆盖近 90 天窗口内的作品，窗口外的取不到。
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="5秒完播率" value={pct(w.completionRate5s)} note="开头 5 秒留住了多少人。" />
              <Stat label="2秒跳出率" value={pct(w.bounceRate2s)} note="两秒内划走的比例。" />
              <Stat
                label="平均播放时长"
                value={`${(w.avgPlayDurationSec ?? 0).toFixed(1)}s`}
                note={w.durationSec > 0 ? `片长 ${w.durationSec}s，看完了约 ${pct((w.avgPlayDurationSec ?? 0) / w.durationSec, 0)}。` : undefined}
              />
              <Stat label="互动" value={`${w.digg} / ${w.comment} / ${w.collect}`} note="赞 / 评 / 藏。" />
            </div>
          </>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold">播放来自哪里</h2>
        {perClient ? (
          <div className="mt-2 grid grid-cols-3 gap-3">
            {(
              [
                ['抖音', perClient.douyin_value ?? 0],
                ['西瓜', perClient.xigua_value ?? 0],
                ['Yumme', perClient.yumme_value ?? 0],
              ] as const
            ).map(([label, v]) => (
              <Stat key={label} label={label} value={humanCount(v)} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">这条没有分端数据。</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <span className="text-foreground">拿不到的：</span>
          流量来源分布（推荐页 / 关注页 / 搜索 / 个人主页）和人群画像（年龄、性别、地域）
          不在这组接口里。抖音 App 端能看到，网页后台的这几条接口没给——
          编一个出来比没有更糟，所以这里空着。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold">钩子</h2>
        <p className="mt-2 rounded-md border-l-2 border-foreground/25 bg-secondary/45 p-3.5 text-sm leading-relaxed">
          {firstLine || '（文案是空的）'}
        </p>
        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {[
            ['点了痛点', features.painPoint],
            ['有数字', features.hasNumber],
            ['有提问', features.hasQuestion],
            ['第一人称', features.firstPerson],
          ].map(([label, on]) => (
            <span
              key={String(label)}
              className={
                on
                  ? 'rounded bg-secondary px-2 py-0.5'
                  : 'rounded px-2 py-0.5 text-muted-foreground/50'
              }
            >
              {String(label)}
            </span>
          ))}
        </p>

        {hookAct ? (
          <div className="mt-3 rounded-md border border-border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              稿子里的开场
            </p>
            <p className="mt-1.5 text-sm leading-relaxed">{hookAct.narration || '（这一幕是空的）'}</p>
            {hard ? (
              <p className="mt-2 text-xs text-muted-foreground">
                这份稿子的硬指标 {hard.total}/{hard.max}。
                <Link href={`/write/${w.scriptDraftId}`} className="ml-1 underline underline-offset-4">
                  去看稿子
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            这条还没关联稿子。关联之后这里会显示稿子里的开场和它的预测分——
            <span className="text-foreground">「写的时候打几分 / 发出去留住了多少人」的对照就是从这来的</span>。
          </p>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold">文案</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {w.caption || '（空）'}
        </p>
        {hashtags.length > 0 ? (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {hashtags.map((t) => (
              <span key={t} className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                #{t}
              </span>
            ))}
          </p>
        ) : null}
      </section>
    </PageShell>
  );
}
