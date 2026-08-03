'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cockpit } from '@/components/workbench/cockpit';
import { Kanban } from '@/components/workbench/kanban';
import type { WorkbenchData } from '@/lib/pipeline/types';
import type { DashboardSummary } from '@/lib/dashboard/types';

export default function WorkbenchPage() {
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch('/api/v1/workbench')
      .then((r) => r.json())
      .then((j) => (j.success ? setData(j.data) : setError(j.message ?? '加载失败')))
      .catch(() => setError('加载失败'));
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/v1/dashboard/summary')
      .then((r) => r.json())
      .then((j) => j.success && setSummary(j.data))
      .catch(() => {}); // 摘要失败不阻塞工作台
  }, [reload]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Cockpit data={data} summary={summary} />
      <Kanban data={data} onChanged={reload} />
    </div>
  );
}
