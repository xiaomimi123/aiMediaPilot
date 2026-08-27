'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptAct } from '@/lib/script/six-act';
import { buildActPlan } from '@/lib/script/act-plan';
import { scoreHardDimensions, type ScoreDimension } from '@/lib/cockpit/script-score';
import { buttonVariants } from '@/components/ui/button';
import { ActNav } from './act-nav';
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
}: {
  scriptId: string;
  topic: string;
  platform: string;
  durationSec: number;
  initialActs: ScriptAct[];
  softScore: number | null;
  softMax: number;
  softDimensions: ScoreDimension[];
}) {
  const [acts, setActs] = useState(initialActs);
  const [dirty, setDirty] = useState(false);
  const [currentAct, setCurrentAct] = useState(initialActs[0]?.act ?? 'hook');

  const save = useAutoSave(scriptId, acts, dirty);

  const plan = useMemo(() => buildActPlan(acts, durationSec), [acts, durationSec]);
  const hard = useMemo(() => scoreHardDimensions(acts), [acts]);
  const current = acts.find((a) => a.act === currentAct) ?? acts[0];

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
      <header className="mb-4 flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{topic}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {platform} · 全片 {durationSec} 秒 · 实际 {plan.totalActualSec} 秒
          </p>
        </div>
        <p className="shrink-0 text-sm tabular-nums">
          硬指标 {hard.total}/{hard.max}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 overflow-y-auto">
        <ActNav plan={plan} current={currentAct} onSelect={setCurrentAct} />
        <ActEditor act={current} onChange={patchCurrent} />
        <ScorePanel
          hard={hard.total}
          hardMax={hard.max}
          hardDimensions={hard.dimensions}
          soft={softScore}
          softMax={softMax}
          softDimensions={softDimensions}
        />
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
