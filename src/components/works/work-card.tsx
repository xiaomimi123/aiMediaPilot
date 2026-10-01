import Link from 'next/link';
import { fmtViews } from '@/lib/predict/formula';
import { nextActionText, STAGE_TEXT, type WorkCardData } from '@/lib/overview/steps';
import { StepDots } from './step-dots';

export function WorkCard({ card }: { card: WorkCardData }) {
  const cur = card.steps.find((s) => s.current)!;
  const published = card.steps.find((s) => s.key === 'publish')!.done;
  return (
    <Link href={`/projects/${card.id}`} className="card block transition-shadow hover:shadow-[var(--shadow-pop)]">
      <div className="mb-2 line-clamp-2 text-[15px] font-semibold">{card.title}</div>
      <StepDots steps={card.steps} />
      <div className="mt-2 text-xs text-[var(--text-secondary)]">{`${STAGE_TEXT[card.stage] ?? card.stage} · ${nextActionText(cur.key)}`}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-tertiary)]">
        {published && card.views !== null && <span className="chip">{`播放 ${fmtViews(card.views)}`}</span>}
        {!published && card.center !== null && <span className="chip">{`预测 ~${card.center.toLocaleString('en-US')}`}</span>}
        {card.durationSec !== null && <span className="tabular-nums">{`约 ${card.durationSec} 秒`}</span>}
        <span className="ml-auto tabular-nums">{new Date(card.updatedAt).toLocaleDateString('zh-CN')}</span>
      </div>
    </Link>
  );
}
