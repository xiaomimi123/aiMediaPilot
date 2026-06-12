'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ProgressStages } from '@/components/content/progress-stages';
import { ReportView } from '@/components/content/report-view';

type Analysis = {
  id: string;
  videoFilename: string;
  videoDurationSec: number;
  status: string;
  errorMessage: string | null;
  report: any | null;
  llmUsage: any | null;
  coverCandidates: { path: string; timestampSec: number }[] | null;
  retryCount: number;
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
    es.onerror = () => es.close();
    fetch(`/api/v1/content/analyses/${params.id}`).then((r) => r.json()).then((j) => {
      if (j.success) setData(j.data);
    });
    return () => es.close();
  }, [params?.id]);

  if (!data) return <p className="text-sm text-muted-foreground">加载中...</p>;

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
  const cost = data.llmUsage?.total?.estCostUSD;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">📹 {data.videoFilename}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          时长 {Math.round(data.videoDurationSec)} 秒
          {cost !== undefined ? ` · 烧 $${cost.toFixed(3)}` : ''}
          {data.retryCount > 0 ? ` · 已重试 ${data.retryCount} 次` : ''}
        </p>
      </div>

      <ProgressStages status={data.status} errorMessage={data.errorMessage} />

      {data.status === 'COMPLETED' && data.report && (
        <ReportView
          analysisId={data.id}
          report={data.report}
          coverCandidateCount={data.coverCandidates?.length ?? 0}
        />
      )}

      <div className="flex gap-2">
        {isRunning && <Button variant="outline" onClick={handleCancel}>取消</Button>}
        {data.status === 'FAILED' && data.retryCount < 3 && <Button onClick={handleRetry}>重新分析</Button>}
        <Button variant="outline" onClick={handleDelete}>删除</Button>
      </div>
    </div>
  );
}
