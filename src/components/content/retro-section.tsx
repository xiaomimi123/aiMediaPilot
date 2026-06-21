'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PublishLinkForm } from './publish-link-form';
import { ActualMetricsTable } from './actual-metrics-table';
import { RetroGapView } from './retro-gap-view';

type AnalysisV2 = {
  id: string;
  douyinUrl: string | null;
  douyinAwemeId: string | null;
  publishedAt: string | null;
  retroStatus: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  retroErrorMessage: string | null;
  retroReport: any | null;
  actualMetric: any | null;
};

export function RetroSection({ analysis, onChanged }: { analysis: AnalysisV2; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);

  const handleRetroNow = async () => {
    await fetch(`/api/v1/content/analyses/${analysis.id}/retro-now`, { method: 'POST' });
    onChanged();
  };

  // 状态: 空 (没填 URL) 或 用户点了"重设链接"
  if (!analysis.retroStatus || showForm) {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">📊 发后复盘</h2>
        <PublishLinkForm
          analysisId={analysis.id}
          initialUrl={analysis.douyinUrl}
          initialPublishedAt={analysis.publishedAt}
          onSaved={() => { setShowForm(false); onChanged(); }}
        />
      </div>
    );
  }

  // 计算 scheduledAt
  const scheduledAt = analysis.publishedAt
    ? new Date(new Date(analysis.publishedAt).getTime() + 3 * 86400000)
    : null;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">📊 发后复盘</h2>

      {/* 状态: SCHEDULED */}
      {analysis.retroStatus === 'SCHEDULED' && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="text-sm">✓ 已关联: <a href={analysis.douyinUrl!} target="_blank" rel="noreferrer" className="text-primary underline">{analysis.douyinUrl}</a></div>
          {scheduledAt && (
            <div className="text-sm text-muted-foreground">
              ⏰ 计划于 {scheduledAt.toLocaleString()} 自动拉取
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRetroNow}>立刻拉一次</Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>重设链接</Button>
          </div>
        </div>
      )}

      {/* 状态: RUNNING */}
      {analysis.retroStatus === 'RUNNING' && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm">🔄 正在拉取真实数据... (创作者中心 → 视频详情)</div>
        </div>
      )}

      {/* 状态: FAILED */}
      {analysis.retroStatus === 'FAILED' && (
        <div className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4">
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            ✗ 拉取失败: {analysis.retroErrorMessage ?? '未知错误'}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRetroNow}>重新拉取</Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>重设链接</Button>
          </div>
        </div>
      )}

      {/* 状态: COMPLETED */}
      {analysis.retroStatus === 'COMPLETED' && analysis.actualMetric && (
        <div className="space-y-4">
          <ActualMetricsTable metric={analysis.actualMetric} />
          {analysis.retroReport ? (
            <RetroGapView report={analysis.retroReport} />
          ) : (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ AI 落差总结生成失败,可点 [重新拉取] 再试
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleRetroNow}>重新拉取数据</Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>重设链接 (改换关联视频)</Button>
          </div>
        </div>
      )}
    </div>
  );
}
