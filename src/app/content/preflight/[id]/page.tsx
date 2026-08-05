'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ProgressStages } from '@/components/content/progress-stages';
import { ReportView } from '@/components/content/report-view';
import { RetroSection } from '@/components/content/retro-section';
import { PredictionCard } from '@/components/content/prediction-card';
import { PublishChecklist } from '@/components/content/publish-checklist';
import type { PublishChecklistState } from '@/lib/checklist/types';
import type { PredictedPlaysRange } from '@/lib/prediction/types';
import { readHookScore } from '@/lib/json-readers';

// Prisma Json 字段 — 运行时由各 zod schema 保证形状, 这里用 Record<string, unknown> 替代 any,
// 保留 TS noUncheckedAccess 检查, 在向下游组件传时再 cast 到具体类型.
type Report = Record<string, unknown>;
type LLMUsage = Record<string, unknown>;

type Analysis = {
  id: string;
  videoFilename: string;
  videoDurationSec: number;
  status: string;
  errorMessage: string | null;
  progress: { stage?: string; percent?: number; label?: string } | null;
  report: Report | null;
  llmUsage: LLMUsage | null;
  coverCandidatesCount: number;
  retryCount: number;
  publishChecklist: PublishChecklistState | null;
  fromScript: { id: string; topic: string } | null;
  // v2
  douyinUrl: string | null;
  douyinAwemeId: string | null;
  publishedAt: string | null;
  retroStatus: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  retroErrorMessage: string | null;
  retroReport: Record<string, unknown> | null;
  actualMetric: Record<string, unknown> | null;
};

export default function PreflightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    const es = new EventSource(`/api/v1/content/analyses/${params.id}/events`);
    es.onmessage = () => {
      // 收到 status 变化通知时拉详情
      fetch(`/api/v1/content/analyses/${params.id}`).then((r) => r.json()).then((j) => {
        if (j.success) setData(j.data);
      });
    };
    fetch(`/api/v1/content/analyses/${params.id}`).then((r) => r.json()).then((j) => {
      if (j.success) setData(j.data);
    });
    return () => es.close();
  }, [params?.id]);

  if (!data) return <p className="text-sm text-[var(--muted)]">加载中...</p>;

  const handleCancel = async () => {
    await fetch(`/api/v1/content/analyses/${data.id}/cancel`, { method: 'POST' });
  };
  const handleRetry = async () => {
    await fetch(`/api/v1/content/analyses/${data.id}/retry`, { method: 'POST' });
  };
  const handleDelete = async () => {
    if (!confirm('确认删除该分析? 视频和报告会一并删除。')) return;
    await fetch(`/api/v1/content/analyses/${data.id}`, { method: 'DELETE' });
    router.push('/content/preflight');
  };

  const isRunning = data.status === 'PREPROCESSING' || data.status === 'ANALYZING' || data.status === 'QUEUED';
  const cost = (data.llmUsage as { total?: { estCostUSD?: number } } | null)?.total?.estCostUSD;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">📹 {data.videoFilename}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          时长 {Math.round(data.videoDurationSec)} 秒
          {cost !== undefined ? ` · 烧 $${cost.toFixed(3)}` : ''}
          {data.retryCount > 0 ? ` · 已重试 ${data.retryCount} 次` : ''}
        </p>
        {data.fromScript && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            📜 来自脚本:{' '}
            <a href={`/content/script/${data.fromScript.id}`} className="hover:text-primary underline-offset-2 hover:underline">
              {data.fromScript.topic}
            </a>
          </p>
        )}
      </div>

      <ProgressStages status={data.status} progress={data.progress} errorMessage={data.errorMessage} />

      {data.status === 'COMPLETED' && data.report && (
        <PredictionCard data={data.report.predictedPlaysRange as PredictedPlaysRange | null | undefined} />
      )}

      {data.status === 'COMPLETED' && data.report && (
        <ReportView
          analysisId={data.id}
          report={data.report as Parameters<typeof ReportView>[0]['report']}
          coverCandidateCount={data.coverCandidatesCount}
        />
      )}

      {data.status === 'COMPLETED' && data.report && (
        <PublishChecklist
          analysisId={data.id}
          niche={(data.report.niche as string | undefined) || 'ai-knowledge'}
          hookScore={readHookScore(data.report)}
          topActionItems={(data.report.topActionItems ?? []) as string[]}
          initial={data.publishChecklist}
        />
      )}

      {data.status === 'COMPLETED' && (
        <RetroSection analysis={data} onChanged={() => {
          fetch(`/api/v1/content/analyses/${data.id}`).then((r) => r.json()).then((j) => {
            if (j.success) setData(j.data);
          });
        }} />
      )}

      <div className="flex gap-2">
        {isRunning && <Button variant="outline" onClick={handleCancel}>取消</Button>}
        {data.status === 'FAILED' && data.retryCount < 3 && <Button onClick={handleRetry}>重新分析</Button>}
        <Button variant="outline" onClick={handleDelete}>删除</Button>
      </div>
    </div>
  );
}
