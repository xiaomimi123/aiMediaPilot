'use client';

import Link from 'next/link';
import { Lightbulb, FileText, CheckCircle2, Clapperboard, Send, RotateCw, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkbenchData } from '@/lib/pipeline/types';
import type { DashboardSummary } from '@/lib/dashboard/types';

const TILES: { key: keyof WorkbenchData['counts']; label: string; icon: LucideIcon; anchor: string; cls: string }[] = [
  { key: 'pool', label: '选题池', icon: Lightbulb, anchor: '#col-pool', cls: 'bg-yellow-50 border-yellow-200 text-yellow-900' },
  { key: 'drafting', label: '草稿', icon: FileText, anchor: '#col-drafting', cls: 'bg-purple-50 border-purple-200 text-purple-900' },
  { key: 'ready', label: '定稿待拍', icon: CheckCircle2, anchor: '#col-ready', cls: 'bg-green-50 border-green-200 text-green-900' },
  { key: 'shot', label: '已拍待发', icon: Clapperboard, anchor: '#col-shot', cls: 'bg-amber-50 border-amber-200 text-amber-900' },
  { key: 'published', label: '待复盘', icon: Send, anchor: '#col-published', cls: 'bg-blue-50 border-blue-200 text-blue-900' },
  { key: 'retroed', label: '已复盘', icon: RotateCw, anchor: '#col-retroed', cls: 'bg-slate-50 border-slate-200 text-slate-900' },
];

export function Cockpit({ data, summary }: { data: WorkbenchData; summary: DashboardSummary | null }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">🎛️ 今日驾驶舱</h2>
          <Link
            href="/agent/discover"
            className="flex items-center gap-1.5 rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white shadow-sm"
          >
            <Sparkles className="h-4 w-4" /> 抓灵感
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {TILES.map(({ key, label, icon: Icon, anchor, cls }) => (
            <a key={key} href={anchor} className={cn('rounded-lg border p-3 transition-colors hover:opacity-80', cls)}>
              <Icon className="h-4 w-4 opacity-70" />
              <div className="mt-1 text-2xl font-bold tabular-nums">{data.counts[key]}</div>
              <div className="text-xs opacity-75">{label}</div>
            </a>
          ))}
        </div>
        {summary && (
          <p className="text-sm text-muted-foreground">
            近 7 天分析 {summary.stats.last7dCount} 条 · 累计复盘 {summary.stats.retroedCount} 条 ·{' '}
            <Link href="/dashboard" className="underline">看完整数据 →</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
