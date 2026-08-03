'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ContentCard } from '@/lib/pipeline/types';
import { distributionPlatformMeta } from '@/lib/pipeline/platforms';
import { cn } from '@/lib/utils';
import { DistributionModal } from './distribution-modal';

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

const DISTRIBUTABLE_STAGES = ['SHOT', 'PUBLISHED', 'RETROED'];

export function ContentCardView({ card, onChanged }: { card: ContentCard; onChanged?: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const days = daysSince(card.stageSince);
  const showDistributeButton = card.kind === 'script' && DISTRIBUTABLE_STAGES.includes(card.stage);

  return (
    <div className="block rounded-lg border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-md">
      <Link href={card.detailUrl} className="line-clamp-2 block font-medium">
        {card.title}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{distributionPlatformMeta(card.platform).label}</span>
        {card.kind === 'analysis' && <span className="rounded bg-muted px-1">视频分析</span>}
        {days > 0 && <span>停留 {days} 天</span>}
        {card.retroCountdownDays != null && (
          <span className="rounded bg-blue-100 px-1 text-blue-900">
            {card.retroCountdownDays === 0 ? '复盘就绪' : `T-${card.retroCountdownDays}d 复盘`}
          </span>
        )}
      </div>
      {card.distributionCount > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.distributionPlatforms.map((p) => {
            const meta = distributionPlatformMeta(p);
            return (
              <span key={p} className={cn('rounded px-1.5 py-0.5 text-[10px]', meta.badgeClass)}>
                {meta.label}
              </span>
            );
          })}
        </div>
      )}
      {showDistributeButton && (
        <button
          onClick={() => setModalOpen(true)}
          className="mt-1.5 text-xs text-muted-foreground underline hover:text-foreground"
        >
          + 登记分发
        </button>
      )}
      {modalOpen && (
        <DistributionModal scriptId={card.id} onDone={() => onChanged?.()} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}
