'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptAct } from '@/lib/script/six-act';
import { buildActPlan } from '@/lib/script/act-plan';
import { scoreHardDimensions, type ScoreDimension } from '@/lib/cockpit/script-score';
import { buttonVariants } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { MaterialPanel } from './material-panel';
import { RewritePanel } from './rewrite-panel';
import { compareToBaseline } from '@/lib/script/rewrite-diff';
import { ActStrip } from './act-strip';
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
}) {
  const [acts, setActs] = useState(initialActs);
  const [dirty, setDirty] = useState(false);
  const [currentAct, setCurrentAct] = useState(initialActs[0]?.act ?? 'hook');

  const save = useAutoSave(scriptId, acts, dirty);

  const [panel, setPanel] = useState<'score' | 'rewrite' | 'material'>('score');

  const plan = useMemo(() => buildActPlan(acts, durationSec), [acts, durationSec]);
  const hard = useMemo(() => scoreHardDimensions(acts, durationSec), [acts, durationSec]);
  const current = acts.find((a) => a.act === currentAct) ?? acts[0];
  const currentRow = plan.rows.find((r) => r.act === currentAct);

  // 「我的版 vs AI 版」: 改写度 + AI 原版的硬指标, 都是纯函数, 随打字实时重算
  const comparison = useMemo(
    () => compareToBaseline(acts, aiBaselineActs),
    [acts, aiBaselineActs],
  );
  const baselineHard = useMemo(
    () => (aiBaselineActs ? scoreHardDimensions(aiBaselineActs, durationSec).total : null),
    [aiBaselineActs, durationSec],
  );
  // 评分模型换过之后旧软分不可比, 不计入总分
  const countSoft = softScore !== null && softStaleReason !== 'model';

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
    return <p className="text-sm text-muted-foreground">这份稿子没有可编辑的幕。</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{topic}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5">{platform}</span>
            <span className="rounded bg-secondary px-1.5 py-0.5">{durationSec} 秒</span>
            <span className="tabular-nums">实际 {plan.totalActualSec.toFixed(1)} 秒</span>
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-border px-4 py-2 text-center">
          {/* 软指标作废时只报硬指标 —— 把旧模型的分加进总分会拼出一个不可比的数字 */}
          <p className="text-xs text-muted-foreground">{countSoft ? '总分' : '硬指标'}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {hard.total + (countSoft ? softScore! : 0)}
            <span className="text-sm font-normal text-muted-foreground">
              /{hard.max + (countSoft ? softMax : 0)}
            </span>
          </p>
        </div>
      </header>

      <ActStrip plan={plan} current={currentAct} onSelect={setCurrentAct} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-y-auto">
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-sm font-medium">{currentRow?.label ?? current.title}</h2>
            {currentRow ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs tabular-nums">
                目标 {currentRow.targetSec.toFixed(1)}s
              </span>
            ) : null}
          </div>
          <ActEditor act={current} targetSec={currentRow?.targetSec ?? 0} onChange={patchCurrent} />
        </section>

        <aside className="flex w-[220px] shrink-0 flex-col gap-3">
          <Tabs
            tabs={[
              { value: 'score' as const, label: '评分' },
              { value: 'rewrite' as const, label: '改写' },
              { value: 'material' as const, label: '素材' },
            ]}
            value={panel}
            onChange={setPanel}
          />
          {panel === 'rewrite' ? (
            <RewritePanel
              comparison={comparison}
              hardTotal={hard.total}
              baselineHardTotal={baselineHard}
              hardMax={hard.max}
            />
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
            />
          ) : null}
        </aside>
      </div>

      <footer className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-3">
        <p
          className={cnSave(save.status)}
          role={save.status === 'error' ? 'alert' : undefined}
        >
          {saveLabel(save)}
        </p>
        <div className="flex gap-2">
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
        </div>
      </footer>
    </div>
  );
}

function cnSave(status: SaveState['status']): string {
  return status === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground';
}
