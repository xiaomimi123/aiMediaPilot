'use client';

import { cn } from '@/lib/utils';
import { OVERLAY_SLOTS, OVERLAY_KINDS, type OverlayItem, type OverlayKind, type OverlaySlot } from '@/lib/video-production/overlay-plan';

/**
 * 剪辑台「文字叠加」编辑区(三十七期 Task 5)——AI 从口播里提的草案(`OverlayItem[]`),
 * 逐条可改: kind/text/slot/起止秒, 拖预览里的字会写回 x/y(Task 6), 这里只负责
 * "恢复格位"(删掉 x/y 两键, 退回按 slot 的默认格位)。
 *
 * **纯 props 进 props 出**——同 `StyleControls` 的先例(`film-plan-workbench.tsx`
 * 顶部注释), 不自己拉数据、不自己发请求, 由 `film-plan-workbench.tsx` 管 state
 * 与保存。这样能被单测直接挂载, 不需要 mock 一整套 GET/PUT/PATCH。
 *
 * text 上限 14 字——与 `OverlayPlanSchema` 的 `max(14)` 同一条上限(见
 * `overlay-plan.ts` 顶部注释), 前端计数只是提前给红字提示, 真正把关的是
 * 服务端 schema。
 */

const KIND_LABELS: Record<OverlayKind, string> = {
  keyword: '关键词',
  note: '注解',
  arrow: '箭头',
};

const SLOT_LABELS: Record<OverlaySlot, string> = {
  'left-1': '左1',
  'left-2': '左2',
  'left-3': '左3',
  'left-4': '左4',
  'left-5': '左5',
  'top-center': '顶部',
  'bottom-center': '底部',
};

const TEXT_MAX = 14;

function msToSec(ms: number): number {
  return Math.round((ms / 1000) * 10) / 10;
}

function secToMs(sec: number): number {
  return Math.round(sec * 1000);
}

/** 一条空白默认条目——「加一条」按钮追加的初值。 */
function blankItem(): OverlayItem {
  return { kind: 'keyword', text: '', slot: 'left-1', startMs: 0, endMs: 3000 };
}

export interface OverlayEditorProps {
  items: OverlayItem[];
  onChange: (items: OverlayItem[]) => void;
}

export function OverlayEditor({ items, onChange }: OverlayEditorProps) {
  function updateItem(idx: number, patch: Partial<OverlayItem>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function addItem() {
    onChange([...items, blankItem()]);
  }

  /** 恢复格位——删掉这一条的 x/y 两键, 退回按 slot 算出的默认位置。 */
  function restoreSlot(idx: number) {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const { x: _x, y: _y, ...rest } = it;
      return rest;
    });
    onChange(next);
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-background p-3" data-testid="overlay-editor">
      <h3 className="text-sm font-medium">文字叠加</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        AI 从口播里提的草案——改文本、换格位、拖预览里的字都行。空文本的条目保存时会被丢弃。
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {items.map((item, idx) => {
          const isArrow = item.kind === 'arrow';
          const hasOverride = item.x !== undefined || item.y !== undefined;
          const textLen = item.text.length;
          const textTooLong = textLen > TEXT_MAX;
          return (
            <div
              // eslint-disable-next-line react/no-array-index-key -- 条目没有稳定 id, 顺序即身份, 同 SlotFields 惯例
              key={idx}
              className="flex flex-wrap items-end gap-2 rounded border border-border bg-card p-2 text-xs"
            >
              <label className="flex flex-col gap-1">
                类型
                <select
                  value={item.kind}
                  onChange={(e) => {
                    const kind = e.target.value as OverlayKind;
                    // 切到 arrow 时清空 text——arrow 的 text 输入本身就禁用置空。
                    updateItem(idx, kind === 'arrow' ? { kind, text: '' } : { kind });
                  }}
                  className="rounded border border-input bg-card px-2 py-1"
                >
                  {OVERLAY_KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                文本
                <input
                  value={item.text}
                  disabled={isArrow}
                  onChange={(e) => updateItem(idx, { text: e.target.value })}
                  className={cn(
                    'w-32 rounded border bg-card px-2 py-1 disabled:opacity-50',
                    textTooLong ? 'border-destructive' : 'border-input',
                  )}
                />
                <span className={cn(textTooLong ? 'text-destructive' : 'text-muted-foreground')}>
                  {`${textLen}/${TEXT_MAX}`}
                </span>
              </label>

              <label className="flex flex-col gap-1">
                格位
                <select
                  value={item.slot}
                  onChange={(e) => updateItem(idx, { slot: e.target.value as OverlaySlot })}
                  className="rounded border border-input bg-card px-2 py-1"
                >
                  {OVERLAY_SLOTS.map((s) => (
                    <option key={s} value={s}>{SLOT_LABELS[s]}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                起始（秒）
                <input
                  type="number"
                  step="0.1"
                  value={msToSec(item.startMs)}
                  onChange={(e) => {
                    const v = e.target.valueAsNumber;
                    if (!Number.isNaN(v)) updateItem(idx, { startMs: secToMs(v) });
                  }}
                  className="w-20 rounded border border-input bg-card px-2 py-1"
                />
              </label>

              <label className="flex flex-col gap-1">
                结束（秒）
                <input
                  type="number"
                  step="0.1"
                  value={msToSec(item.endMs)}
                  onChange={(e) => {
                    const v = e.target.valueAsNumber;
                    if (!Number.isNaN(v)) updateItem(idx, { endMs: secToMs(v) });
                  }}
                  className="w-20 rounded border border-input bg-card px-2 py-1"
                />
              </label>

              {hasOverride ? (
                <div className="flex flex-col gap-1">
                  <span className="rounded bg-secondary/60 px-2 py-1 text-center text-muted-foreground">已拖动</span>
                  <button
                    type="button"
                    onClick={() => restoreSlot(idx)}
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    恢复格位
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="ml-auto self-center text-destructive underline underline-offset-2 hover:opacity-80"
              >
                删
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="mt-2 rounded border border-border px-2 py-1 text-xs hover:border-foreground/30"
      >
        加一条
      </button>
    </div>
  );
}
