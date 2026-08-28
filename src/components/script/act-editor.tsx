'use client';

import type { ScriptAct, ActFact } from '@/lib/script/six-act';
import { estimateSpokenSec } from '@/lib/script/act-plan';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef } from 'react';
import { diagnoseSentences } from '@/lib/script/sentence-diagnosis';

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
  marginal = false,
  autoGrow = false,
}: {
  label: string;
  hint?: string;
  value: string;
  rows: number;
  onChange: (v: string) => void;
  /** 右上角的实时计数, 只有旁白需要。 */
  meter?: React.ReactNode;
  /** 页边批注样式 —— 用来把「指令」和「正文」在视觉上分开。 */
  marginal?: boolean;
  /** 按内容自动撑高。骨架的指令长度不可预测, 猜行数一定会裁掉一半。 */
  autoGrow?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autoGrow, value]);

  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {hint ? <span className="ml-2 text-xs text-muted-foreground/70">{hint}</span> : null}
      {meter ? <span className="float-right">{meter}</span> : null}
      <textarea
        ref={ref}
        // 无障碍名只取 label —— 包裹式 <label> 的可访问名会把 hint 和实时计数
        // 一起算进去, 计数每打一个字就变, 名字跟着变。
        aria-label={label}
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'mt-1.5 w-full rounded-md p-3.5 text-sm leading-[1.85] focus-visible:outline-none',
          autoGrow ? 'resize-none overflow-hidden' : 'resize-y',
          marginal
            ? 'border-l-2 border-foreground/25 bg-secondary/45 text-muted-foreground focus:border-foreground/60 focus:text-foreground'
            : 'border border-input bg-card focus:border-foreground/40',
        )}
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

  /*
   * 逐句诊断。纯函数, 随打字实时重算, 不调模型。
   *
   * 放在旁白**正下方**而不是右侧评分栏: 评分栏回答「这稿子几分」, 这里回答
   * 「我该看哪一句」—— 后者只在你正盯着这一幕改的时候才有用, 隔一屏就等于没有。
   *
   * 只报问题的位置, 不给替换文字: 让模型判断「这句好不好」, 它下一句必然是
   * 「不如改成……」, 而 AI 润色过的句子, AI 也会写给别人。
   */
  const flagged = useMemo(
    () => diagnoseSentences(act.narration).filter((x) => x.issues.length > 0),
    [act.narration],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/*
        备注排在旁白**之上**。骨架模式下它装的是「这一幕该干什么 + 需要什么材料」,
        也就是你照着写的东西 —— 排在旁白下面就意味着写的时候看不见它, 那等于没有。
        样式做成页边批注(左侧一条墨规 + 米色底), 一眼能看出它不是正文。
      */}
      <Field
        label="备注"
        hint="骨架的指令 / 给自己的拍摄提示，不进成片"
        value={act.note}
        rows={2}
        onChange={(note) => onChange({ note })}
        marginal
        autoGrow
      />
      <Field
        label="旁白"
        hint="录的时候念的就是这段"
        value={act.narration}
        rows={5}
        onChange={(narration) => onChange({ narration })}
        meter={
          <span className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
            {chars} 字 · {sec.toFixed(1)}s
            {targetSec > 0 ? <span className="text-muted-foreground"> / 目标 {targetSec.toFixed(1)}s</span> : null}
          </span>
        }
      />
      {flagged.length > 0 ? (
        <ul className="-mt-2 flex flex-col gap-1.5">
          {flagged.map((f) => (
            <li key={f.start} className="border-l-2 border-destructive/40 pl-2.5 text-xs leading-relaxed">
              <p className="text-muted-foreground">{f.text}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-destructive">
                {f.issues.map((i) => (
                  <span key={i.kind}>{i.detail}</span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <Field
        label="画面"
        hint="这一幕拍什么 / 放什么"
        value={act.visual}
        rows={2}
        onChange={(visual) => onChange({ visual })}
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
