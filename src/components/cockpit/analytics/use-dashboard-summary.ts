import { useEffect, useState } from 'react';
import type { DashboardSummary } from '@/lib/dashboard/types';

/**
 * 单次拉取 /api/v1/dashboard/summary，module-level 缓存 in-flight promise，
 * 避免复盘实验室 (PredictionPanel) 与大目标 (PerformancePanel) 同一会话内挂载时重复请求。
 */
let inFlight: Promise<DashboardSummary> | null = null;

function fetchSummary(): Promise<DashboardSummary> {
  if (!inFlight) {
    inFlight = fetch('/api/v1/dashboard/summary')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) return j.data as DashboardSummary;
        throw new Error(j.message ?? '数据加载失败');
      })
      .catch((e) => {
        inFlight = null; // 失败后允许重试
        throw e;
      });
  }
  return inFlight;
}

export function useDashboardSummary(): {
  data: DashboardSummary | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSummary()
      .then((summary) => {
        if (!cancelled) {
          setData(summary);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
