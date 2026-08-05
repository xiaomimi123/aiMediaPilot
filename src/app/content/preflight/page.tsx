'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type AnalysisRow = {
  id: string;
  videoFilename: string;
  videoDurationSec: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  overallScore: number | null;
  topActionItems: string[];
  estCostUSD: number | null;
  progress: { stage?: string; percent?: number; label?: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  QUEUED: '排队中',
  PREPROCESSING: '预处理中',
  ANALYZING: 'AI 分析中',
  COMPLETED: '✓ 完成',
  FAILED: '✗ 失败',
  CANCELLED: '已取消',
};

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return new Date(iso).toLocaleDateString();
}

export default function PreflightListPage() {
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);

  useEffect(() => {
    const tick = () => {
      fetch('/api/v1/content/analyses').then((r) => r.json()).then((j) => {
        if (j.success) setRows(j.data);
      });
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  if (rows === null) return <p className="text-sm text-[var(--muted)]">加载中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">内容预诊断</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">上传视频 → AI 4 维度评估 + L1 预测 + retro 复盘。</p>
        </div>
        <Link href="/content/preflight/new"><Button variant="brand">+ 新分析</Button></Link>
      </div>
      {rows.length === 0 && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] p-12 text-center">
          <p className="text-sm text-[var(--muted)]">还没有分析。点 [+ 新分析] 上传第一个视频。</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Link key={r.id} href={`/content/preflight/${r.id}`}>
            <Card className="cursor-pointer border-[var(--line)] bg-[var(--panel-bg)] transition-shadow hover:shadow-md">
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-center justify-between">
                  <div className="truncate font-semibold">{r.videoFilename}</div>
                  <Badge variant={r.status === 'COMPLETED' ? 'success' : r.status === 'FAILED' ? 'destructive' : 'default'}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {formatTimeAgo(r.createdAt)} · {r.videoDurationSec ? `${Math.round(r.videoDurationSec)} 秒` : ''}
                  {r.estCostUSD !== null ? ` · 烧 $${r.estCostUSD.toFixed(3)}` : ''}
                </div>
                {r.status === 'COMPLETED' && r.overallScore !== null && (
                  <div className="text-sm">
                    overallScore <span className="font-semibold">{r.overallScore}/100</span>
                    {r.topActionItems.length > 0 && (
                      <span className="text-[var(--muted)]"> · Top: {r.topActionItems.slice(0, 2).join('、')}</span>
                    )}
                  </div>
                )}
                {(r.status === 'PREPROCESSING' || r.status === 'ANALYZING') && r.progress?.label && (
                  <div className="text-sm text-[var(--muted)]">{r.progress.label}</div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
