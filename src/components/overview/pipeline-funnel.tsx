import type { PipelineStage } from '@/lib/cockpit/overview';
import { cn } from '@/lib/utils';

/**
 * 内容管线, 步骤条形态(对照设计稿 #p-overview 的 `.pipe`)。
 *
 * 断点/绕过的判断逻辑完全沿用 `buildPipeline`(见 lib/cockpit/overview.ts)——
 * 这里只负责把 `broken`/`bypassed` 翻译成三种视觉状态:
 * - `bypassed` → 黄色「绕过」: 这一环是 0, 但下游有量, 说明流程没经过它, 不是堵住。
 * - `broken`   → 红色「断点」: 上一环有量、这一环是 0、且下游也全是 0, 真正卡住的地方。
 * - 断点之后其余同样是 0 的环 → 灰掉("dead"), 它们是断点的后果, 不是新问题,
 *   不重复标红, 否则会让人分不清该先修哪一个。
 */
function stepTone(s: PipelineStage): 'bypassed' | 'broken' | 'dead' | 'normal' {
  if (s.bypassed) return 'bypassed';
  if (s.broken) return 'broken';
  if (s.count === 0) return 'dead';
  return 'normal';
}

const STEP_CLASS: Record<string, string> = {
  normal: 'border-line bg-elevated text-fg',
  bypassed: 'border-warn bg-warn-subtle text-fg',
  broken: 'border-bad bg-bad-subtle text-fg',
  dead: 'border-line-subtle bg-inset text-fg-4',
};

const NUM_CLASS: Record<string, string> = {
  normal: 'text-fg',
  bypassed: 'text-warn',
  broken: 'text-bad',
  dead: 'text-fg-4',
};

const ARROW_LABEL: Record<string, string> = { bypassed: '绕过', broken: '断点' };
const ARROW_LINE_CLASS: Record<string, string> = {
  normal: 'bg-line-strong',
  bypassed: 'bg-warn',
  broken: 'bg-bad',
  dead: 'bg-line-strong',
};
const ARROW_TEXT_CLASS: Record<string, string> = {
  bypassed: 'text-warn',
  broken: 'text-bad',
};

export function PipelineFunnel({ stages }: { stages: PipelineStage[] }) {
  const brokenIndex = stages.findIndex((s) => s.broken);
  const brokenStage = brokenIndex >= 0 ? stages[brokenIndex] : undefined;
  const nextStage = brokenIndex >= 0 ? stages[brokenIndex + 1] : undefined;

  return (
    <section className="rounded-lg border border-line-subtle bg-surface p-4">
      <div className="mb-3.5 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-fg">内容管线</h2>
        {brokenStage ? (
          <span className="badge-base bg-bad-subtle text-bad">
            断在 {brokenStage.label}{nextStage ? ` → ${nextStage.label}` : ''}
          </span>
        ) : null}
      </div>

      <div className="flex items-center">
        {stages.map((s, i) => {
          const tone = stepTone(s);
          return (
            <div key={s.key} className="flex flex-1 items-center">
              {i > 0 ? (
                <div className="w-12 shrink-0 text-center text-[11px]">
                  <div className={cn('mx-2 mb-0.5 h-0.5', ARROW_LINE_CLASS[tone])} />
                  {ARROW_LABEL[tone] ? (
                    <span className={ARROW_TEXT_CLASS[tone]}>{ARROW_LABEL[tone]}</span>
                  ) : null}
                </div>
              ) : null}
              <div className={cn('flex-1 rounded-lg border px-3.5 py-3 text-center', STEP_CLASS[tone])}>
                <p className={cn('font-mono text-lg font-semibold tabular-nums', NUM_CLASS[tone])}>
                  {s.count}
                </p>
                <p className="mt-1 text-[11px] text-fg-3">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {stages.some((s) => s.bypassed || s.broken) ? (
        <p className="mt-3.5 text-xs leading-relaxed text-fg-3">
          {[
            ...stages.filter((s) => s.bypassed).map((s) => `${s.label}一环被绕过（没走该走的流程）`),
            brokenStage ? `链路断在「${brokenStage.label}」，整条链路的产出目前是 0` : '',
          ].filter(Boolean).join('，')}
          。
        </p>
      ) : null}
    </section>
  );
}
