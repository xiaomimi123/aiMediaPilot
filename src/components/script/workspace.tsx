'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptAct } from '@/lib/script/six-act';
import { buildActPlan } from '@/lib/script/act-plan';
import { scoreHardDimensions, type ScoreDimension, isUnwritten } from '@/lib/cockpit/script-score';
import { buttonVariants } from '@/components/ui/button';
import { MaterialPanel } from './material-panel';
import { RewritePanel } from './rewrite-panel';
import { TitlePanel, type TitleSuggestion } from './title-panel';
import type { CompareAct } from './compare-block';
import { splitGaps } from '@/lib/script/score-gaps';
import { compareToBaseline } from '@/lib/script/rewrite-diff';
import { cn } from '@/lib/utils';
import { ActRail } from './act-rail';
import { ActEditor } from './act-editor';
import { ScorePanel } from './score-panel';

/**
 * 六幕稿工作区(阶段 4)。25/25 的实际使用都发生在这里。
 *
 * **自动保存, 没有保存按钮**: 草稿状态封装在这个组件里不外泄(5.2), 停止输入
 * 1.2 秒后落库。硬指标是纯函数, 每次改动就地重算 —— 改完一句话立刻能看到
 * 简洁度掉没掉, 这是评分体系真正的用法。
 *
 * 底部只有「提词器」和「回稿库」。**不放发起出片的入口** —— 出片链路刚跑通第一次,
 * 在它稳定之前不给它做界面(见 nav.ts 里的同一条规则)。
 */

const SAVE_DEBOUNCE_MS = 1200;

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at: number | null };

function useAutoSave(scriptId: string, acts: ScriptAct[], dirty: boolean) {
  const [save, setSave] = useState<SaveState>({ status: 'idle', at: null });
  const timer = useRef<number | null>(null);
  const latest = useRef(acts);
  latest.current = acts;

  useEffect(() => {
    if (!dirty) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSave((s) => ({ ...s, status: 'saving' }));
      try {
        const res = await fetch(`/api/v1/scripts/${scriptId}/acts`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acts: latest.current }),
        });
        setSave(res.ok ? { status: 'saved', at: Date.now() } : { status: 'error', at: null });
      } catch {
        setSave({ status: 'error', at: null });
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [scriptId, acts, dirty]);

  return save;
}

function saveLabel(save: SaveState): string {
  if (save.status === 'saving') return '保存中…';
  if (save.status === 'error') return '保存失败，改动还在这一页上，别关';
  if (save.status === 'saved') return '已自动保存';
  return '改动会自动保存';
}

export function ScriptWorkspace({
  scriptId,
  topic,
  platform,
  durationSec,
  initialActs,
  softScore,
  softMax,
  softDimensions,
  softStaleReason = null,
  aiBaselineActs = null,
  imported = false,
  titleSuggestions = null,
  compareVersions = null,
}: {
  scriptId: string;
  topic: string;
  platform: string;
  durationSec: number;
  initialActs: ScriptAct[];
  softScore: number | null;
  softMax: number;
  softDimensions: ScoreDimension[];
  softStaleReason?: 'script' | 'model' | null;
  /** AI 原版的六幕, 用来算「这稿子还剩多少是 AI 的」。旧稿没有就是 null。 */
  aiBaselineActs?: ScriptAct[] | null;
  /** 这份稿子是用户自己写好导入的 —— 没有 AI 原版是设计如此, 不是缺数据。 */
  imported?: boolean;
  /** 上次出过的标题, 打开就能看到 —— 不必为了看一眼再花一次模型调用。 */
  titleSuggestions?: { titles: TitleSuggestion[]; tags: string[] } | null;
  /** 对照写法。`forNarration` 是出对照时的正文快照, 用来判断对照过没过期。 */
  compareVersions?: {
    acts: CompareAct[];
    overallNote: string;
    forNarration: Record<string, string>;
  } | null;
}) {
  const [acts, setActs] = useState(initialActs);
  const [dirty, setDirty] = useState(false);
  const [currentAct, setCurrentAct] = useState(initialActs[0]?.act ?? 'hook');

  const save = useAutoSave(scriptId, acts, dirty);


  const [panel, setPanel] = useState<'score' | 'rewrite' | 'title' | 'material'>('score');

  const plan = useMemo(() => buildActPlan(acts, durationSec), [acts, durationSec]);
  const hard = useMemo(() => scoreHardDimensions(acts, durationSec), [acts, durationSec]);
  // 改台词拿不到的那几分单独列 —— 见 score-gaps.ts 的说明
  const gaps = useMemo(() => splitGaps(acts, durationSec), [acts, durationSec]);
  // 骨架稿一打开六幕全空 —— 这时候的分数没有意义, 见页头的说明
  const unwritten = useMemo(() => isUnwritten(acts), [acts]);
  const current = acts.find((a) => a.act === currentAct) ?? acts[0];
  const currentRow = plan.rows.find((r) => r.act === currentAct);

  /*
   * 对照版存在 output 里, 出完要刷新服务端组件才能拿到 —— 但 router.refresh()
   * 不会重置 `acts` 这个 state, 所以正在写的内容不会被吞掉。
   */
  const [compare, setCompare] = useState(compareVersions);
  const currentCompare = compare?.acts.find((c) => c.act === currentAct) ?? null;
  // 出完对照又改了正文: 对照的是旧版本, 要说清楚, 否则他会以为在对着现在这段看
  const compareStale =
    !!currentCompare &&
    (compare?.forNarration?.[currentAct] ?? '') !== (current?.narration ?? '');

  async function reloadCompare() {
    const res = await fetch(`/api/v1/scripts/${scriptId}`);
    const body = await res.json();
    const next = body?.data?.output?.compareVersions;
    if (next) setCompare(next);
  }

  // 「我的版 vs AI 版」: 改写度 + AI 原版的硬指标, 都是纯函数, 随打字实时重算
  const comparison = useMemo(
    () => compareToBaseline(acts, aiBaselineActs),
    [acts, aiBaselineActs],
  );
  const baselineHard = useMemo(
    () => (aiBaselineActs ? scoreHardDimensions(aiBaselineActs, durationSec).total : null),
    [aiBaselineActs, durationSec],
  );
  /**
   * 待处理: 把扣分项翻译成「去改哪一幕的哪个东西」。
   * 只给分不给去处, 用户还是不知道下一步做什么。
   */
  const todos = useMemo(() => {
    const list: { text: string; act?: string }[] = [];
    for (const r of plan.rows) {
      if (r.warn) list.push({ text: `${r.label}超时 ${(r.actualSec - r.targetSec).toFixed(1)} 秒`, act: r.act });
      if (r.missing) list.push({ text: `缺${r.label}`, act: r.act });
    }
    for (const a of acts) {
      for (const f of a.facts ?? []) {
        if (f.confidence === 'low') list.push({ text: `低置信事实待核：${f.claim}`, act: a.act });
      }
    }
    for (const d of hard.dimensions) {
      if (d.score === 0 && d.max > 0) list.push({ text: `${d.label} 0 分：${d.reason}` });
    }
    return list;
  }, [plan, acts, hard]);

  const patchCurrent = useCallback(
    (patch: Partial<ScriptAct>) => {
      setDirty(true);
      setActs((prev) => prev.map((a) => (a.act === currentAct ? { ...a, ...patch } : a)));
    },
    [currentAct],
  );

  if (!current) {
    return <p className="text-sm text-fg-3">这份稿子没有可编辑的幕。</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        topbar 与 PageShell 同形态(58px, 置顶, canvas 底) —— 编辑器是三栏满高布局,
        不套 PageShell 组件本身(它只管单栏正文的 padding), 但视觉上要长得一样。
      */}
      <header className="flex h-topbar shrink-0 items-center gap-2.5 border-b border-line-subtle bg-canvas px-6">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <h1 className="truncate text-base font-semibold text-fg">{topic}</h1>
          <p className="flex flex-wrap items-center gap-x-1.5 truncate text-xs text-fg-3">
            <span>{platform}</span>
            <span>·</span>
            <span>
              目标 <span className="font-mono tabular-nums">{durationSec}</span> 秒
            </span>
            <span>·</span>
            <span>
              实际{' '}
              <span className="font-mono tabular-nums">{plan.totalActualSec.toFixed(1)}</span> 秒
            </span>
            <span>·</span>
            {/* 保存状态照旧走 save.status —— 设计稿这里是静态文案, 但真实状态
                (保存中/失败)比静态文案更重要, 不能为了对齐设计丢掉。 */}
            <span
              className={cn(save.status === 'error' && 'font-medium text-bad')}
              role={save.status === 'error' ? 'alert' : undefined}
            >
              {saveLabel(save)}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Button 只有一个身份(button)。要跳转就用 Link 套 buttonVariants,
              不给 Button 加一个 asChild 之类的 prop 让它在两种身份间切换。 */}
          <Link
            href={`/write/${scriptId}/teleprompter`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            提词器
          </Link>
          <Link href="/scripts" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            回稿库
          </Link>
          {/* 不放「出片」—— 出片链路刚跑通第一次, 稳定之前不给它做界面(同 nav.ts)。 */}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ActRail plan={plan} durationSec={durationSec} current={currentAct} onSelect={setCurrentAct} />

        {/*
          中栏: 当前幕完整展开(.scene 样式), 其余幕折叠成单行卡片。
          折叠行标题不能单独渲染成一个只含幕名的元素 —— 会和左轨那一行的幕名
          撞成两个一模一样的文本节点; 这里把幕名和台词预览拼进同一段文字里,
          视觉上仍然是"幕名 + 台词一行", 但作为一个整体文本存在。
        */}
        <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
          {plan.rows.map((r, i) => {
            const isCurrent = r.act === currentAct;
            if (isCurrent) {
              return (
                <div
                  key={r.act}
                  className="flex flex-col gap-3.5 rounded-xl border border-brand-line bg-surface p-4 pb-[18px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-sm bg-brand px-1.5 py-0.5 text-[11px] text-white">
                      {`幕 ${i + 1}`}
                    </span>
                    <h2 className="min-w-0 flex-1 text-base font-semibold text-fg">{r.label}</h2>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
                        r.warn ? 'bg-warn-subtle text-warn' : 'bg-elevated text-fg-3',
                      )}
                    >
                      {r.actualSec.toFixed(1)}s / 目标 {r.targetSec.toFixed(1)}s
                    </span>
                  </div>
                  <ActEditor
                    act={current}
                    targetSec={currentRow?.targetSec ?? 0}
                    onChange={patchCurrent}
                    compare={currentCompare}
                    compareOriginal={compare?.forNarration?.[currentAct] ?? ''}
                    compareStale={compareStale}
                  />
                </div>
              );
            }
            const act = acts.find((a) => a.act === r.act);
            return (
              <button
                key={r.act}
                type="button"
                onClick={() => setCurrentAct(r.act)}
                className="flex items-center gap-3 rounded-lg border border-line-subtle bg-surface p-4 text-left transition-colors hover:border-line"
              >
                <span className="shrink-0 rounded-sm bg-elevated px-1.5 py-0.5 text-[11px] text-fg-3">
                  {`幕 ${i + 1}`}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium text-fg">{r.label}：</span>
                  <span className="text-fg-3">{act?.narration || '还没写'}</span>
                </p>
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs tabular-nums',
                    r.warn ? 'text-warn' : 'text-fg-3',
                  )}
                >
                  {r.actualSec.toFixed(1)} / {r.targetSec.toFixed(1)}s
                </span>
              </button>
            );
          })}
        </section>

        <aside className="flex w-panel shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line-subtle bg-shell p-[18px]">
          <div className="flex gap-0.5 rounded-lg bg-inset p-[3px]">
            {(
              [
                { value: 'score', label: '评分' },
                { value: 'rewrite', label: '改写' },
                { value: 'title', label: '标题' },
                { value: 'material', label: '素材' },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={panel === t.value}
                onClick={() => setPanel(t.value)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  panel === t.value ? 'bg-elevated text-fg' : 'text-fg-3 hover:text-fg',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {panel === 'rewrite' ? (
            <RewritePanel
              comparison={comparison}
              hardTotal={hard.total}
              baselineHardTotal={baselineHard}
              hardMax={hard.max}
              imported={imported}
              scriptId={scriptId}
              hasCompare={!!compare}
              onCompare={reloadCompare}
            />
          ) : panel === 'title' ? (
            <TitlePanel scriptId={scriptId} initial={titleSuggestions} />
          ) : panel === 'material' ? (
            <MaterialPanel
              narration={current.narration}
              beats={current.beats.map((b) => b.keyword)}
            />
          ) : panel === 'score' ? (
            <ScorePanel
              hard={hard.total}
              hardMax={hard.max}
              hardDimensions={hard.dimensions}
              soft={softScore}
              softMax={softMax}
              softDimensions={softDimensions}
              softStaleReason={softStaleReason}
              todos={todos}
              mechanical={gaps.mechanical}
              unwritten={unwritten}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
