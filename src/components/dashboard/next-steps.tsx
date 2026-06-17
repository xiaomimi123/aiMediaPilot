import Link from 'next/link';
import { Send, RotateCw, FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkflowQueue } from '@/lib/dashboard/types';

interface Props {
  data: WorkflowQueue;
}

export function NextSteps({ data }: Props) {
  if (data.unpublishedAnalyses === 0 && data.awaitingRetro === 0 && data.savedScripts === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h3 className="font-semibold">🚦 接下来该做</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {data.unpublishedAnalyses > 0 && (
            <Tile
              href="/content/preflight"
              icon={Send}
              label="待发"
              count={data.unpublishedAnalyses}
              hint="分析完成但还没发抖音"
              tint="amber"
            />
          )}
          {data.awaitingRetro > 0 && (
            <Tile
              href="/content/retro-sync"
              icon={RotateCw}
              label="待复盘"
              count={data.awaitingRetro}
              hint="已发抖音但 retro 未完成"
              tint="blue"
            />
          )}
          {data.savedScripts > 0 && (
            <Tile
              href="/content/script"
              icon={FileText}
              label="脚本"
              count={data.savedScripts}
              hint="保存的 AI 脚本可继续用"
              tint="purple"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const TINTS = {
  amber: 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-900',
  blue: 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-900',
  purple: 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-900',
} as const;

const ICON_TINTS = {
  amber: 'bg-amber-200 text-amber-800',
  blue: 'bg-blue-200 text-blue-800',
  purple: 'bg-purple-200 text-purple-800',
} as const;

function Tile({
  href,
  icon: Icon,
  label,
  count,
  hint,
  tint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  count: number;
  hint: string;
  tint: keyof typeof TINTS;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        TINTS[tint],
      )}
    >
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ICON_TINTS[tint])}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{count}</span>
          <span className="text-sm">条 {label}</span>
        </div>
        <p className="text-xs opacity-75 truncate">{hint}</p>
      </div>
    </Link>
  );
}
