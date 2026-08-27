'use client';

import type { ScriptAct, ActFact } from '@/lib/script/six-act';
import { estimateSpokenSec } from '@/lib/script/act-plan';
import { cn } from '@/lib/utils';

/**
 * 中栏: 当前幕编辑(阶段 4)。
 *
 * 事实核查按 `confidence` 分级并且**不放折叠区**: 它是六幕稿最有价值的输出之一,
 * 低可信度的那几条恰恰是最需要你在开录前看一眼的 —— 折叠起来等于没有。
 */

function FactCard({ fact }: { fact: ActFact }) {
  const low = fact.confidence === 'low';
  return (
    <li
      className={cn(
        'rounded-md border p-3 text-xs',
        low ? 'border-destructive bg-destructive/5' : 'border-border',
      )}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{fact.claim}</span>
        <span className={cn('shrink-0', low ? 'text-destructive' : 'text-muted-foreground')}>
          {fact.confidence === 'high' ? '可信' : fact.confidence === 'medium' ? '待核' : '存疑'}
        </span>
      </p>
      <p className="mt-1 leading-relaxed">{fact.value}</p>
      {/* 存疑的必须把来源摆出来 —— 你得能自己判断信不信 */}
      {(low || fact.confidence === 'medium') && fact.source ? (
        <p className="mt-1 text-muted-foreground">来源：{fact.source}</p>
      ) : null}
    </li>
  );
}

function Field({
  label,
  hint,
  value,
  rows,
  onChange,
  meter,
}: {
  label: string;
  hint?: string;
  value: string;
  rows: number;
  onChange: (v: string) => void;
  /** 右上角的实时计数, 只有旁白需要。 */
  meter?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      {meter ? <span className="float-right">{meter}</span> : null}
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

export function ActEditor({
  act,
  targetSec,
  onChange,
}: {
  act: ScriptAct;
  /** 这一幕结构上该占多少秒 —— 用来判断旁白写超了没有。 */
  targetSec: number;
  onChange: (patch: Partial<ScriptAct>) => void;
}) {
  // 实时计数: 写多少字、按舒适语速要念多久。这是「快回路」里反馈最快的一条 ——
  // 不用等评分、不用等录制, 打字的同时就知道这一幕撑不撑得下。
  const chars = act.narration.replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）]/g, '').length;
  const sec = estimateSpokenSec(act.narration);
  const over = targetSec > 0 && sec > targetSec * 1.1;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <Field
        label="旁白"
        hint="录的时候念的就是这段"
        value={act.narration}
        rows={6}
        onChange={(narration) => onChange({ narration })}
        meter={
          <span className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
            {chars} 字 · {sec.toFixed(1)}s
            {targetSec > 0 ? <span className="text-muted-foreground"> / 目标 {targetSec.toFixed(1)}s</span> : null}
          </span>
        }
      />
      <Field
        label="画面"
        hint="这一幕拍什么 / 放什么"
        value={act.visual}
        rows={3}
        onChange={(visual) => onChange({ visual })}
      />
      <Field
        label="备注"
        hint="给自己的拍摄提示，不进成片"
        value={act.note}
        rows={2}
        onChange={(note) => onChange({ note })}
      />

      {act.beats.length > 0 ? (
        <div>
          <span className="text-xs font-medium">关键词</span>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {act.beats.map((b, i) => (
              <li key={i} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                {b.keyword}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {act.facts.length > 0 ? (
        <div>
          <span className="text-xs font-medium">事实核查</span>
          <ul className="mt-1 flex flex-col gap-2">
            {act.facts.map((f, i) => (
              <FactCard key={i} fact={f} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
