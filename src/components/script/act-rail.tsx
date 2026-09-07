'use client';

import type { ActPlan, ActPlanRow } from '@/lib/script/act-plan';
import type { ActKey } from '@/lib/script/six-act';
import { cn } from '@/lib/utils';

/**
 * 左轨: 时长分配(三十四期编辑器改版, 对照设计稿 .rail + #sceneRail)。
 *
 * 从横排(act-strip.tsx)改回竖排的理由: 编辑器现在是三栏并排, 横排六张卡会把
 * 中栏和右栏都挤窄; 竖排列表刚好把六幕排成一份「时长清单」, 当前幕高亮,
 * 上下扫一眼就找到。进度条挪到每行**底部一条 2px 细线**——六行叠在一起,
 * 粗进度条反而比数字还抢眼。
 */

/** 全片偏离目标时长超过 10% 才提示——这个阈值和单幕的 OVER_TOLERANCE 是两回事,
 *  单幕判断"写超了", 这里判断"全片跟预算差太多, 要不要重新分配"。 */
const TOTAL_DEVIATION_RATIO = 0.1;

function deviationNote(plan: ActPlan, durationSec: number) {
  if (durationSec <= 0) return null;
  const deviationSec = durationSec - plan.totalActualSec;
  if (Math.abs(deviationSec) <= durationSec * TOTAL_DEVIATION_RATIO) return null;
  const short = deviationSec > 0;
  const worst = plan.rows
    .map((r) => ({ label: r.label, diff: short ? r.targetSec - r.actualSec : r.actualSec - r.targetSec }))
    .filter((d) => d.diff > 0.5)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 2)
    .map((d) => d.label);
  return {
    title: `比目标${short ? '短' : '长'} ${Math.abs(deviationSec).toFixed(0)} 秒`,
    detail:
      worst.length > 0 ? `${worst.join('、')} 差得最多，正片会显得${short ? '赶' : '拖'}。` : null,
  };
}

function RailRow({
  row,
  active,
  onSelect,
}: {
  row: ActPlanRow;
  active: boolean;
  onSelect: () => void;
}) {
  const pct = row.targetSec > 0 ? Math.min(100, (row.actualSec / row.targetSec) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-md px-2.5 py-2 text-left transition-colors',
        active ? 'bg-surface-hover' : 'hover:bg-surface-hover',
      )}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-fg-2">{row.label}</span>
        <span
          className={cn(
            'shrink-0 font-mono text-xs tabular-nums',
            row.warn ? 'text-warn' : 'text-fg-3',
          )}
        >
          {row.actualSec.toFixed(1)}
          <span className="text-fg-4">/{row.targetSec.toFixed(1)}s</span>
        </span>
      </p>
      {row.missing ? (
        <p className="mt-1 text-[11px] text-bad">缺这一幕</p>
      ) : (
        <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-elevated">
          <div
            className={cn('h-full rounded-full', row.warn ? 'bg-warn' : 'bg-brand')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </button>
  );
}

export function ActRail({
  plan,
  durationSec,
  current,
  onSelect,
}: {
  plan: ActPlan;
  durationSec: number;
  current: ActKey;
  onSelect: (act: ActKey) => void;
}) {
  const note = deviationNote(plan, durationSec);

  return (
    <aside className="flex w-rail shrink-0 flex-col gap-3 overflow-y-auto border-r border-line-subtle p-[18px]">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-fg">时长分配</h2>
        <span
          className={cn('font-mono text-xs tabular-nums', note ? 'text-warn' : 'text-fg-3')}
        >
          {plan.totalActualSec.toFixed(1)}s
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {plan.rows.map((r) => (
          <RailRow key={r.act} row={r} active={current === r.act} onSelect={() => onSelect(r.act)} />
        ))}
      </div>

      {note ? (
        <div className="rounded-lg border border-warn bg-warn-subtle px-2.5 py-2">
          <p className="text-xs font-medium text-warn">{note.title}</p>
          {note.detail ? (
            <p className="mt-1 text-[11px] leading-snug text-warn">{note.detail}</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
