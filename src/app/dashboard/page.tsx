'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatsBar } from '@/components/dashboard/stats-bar';
import { EmptyState } from '@/components/dashboard/empty-state';
import { OverallScoreTrend } from '@/components/dashboard/overall-score-trend';
import { CalibrationMatrix } from '@/components/dashboard/calibration-matrix';
import { CalibrationLocked } from '@/components/dashboard/calibration-locked';
import { PredictionAccuracy } from '@/components/dashboard/prediction-accuracy';
import { PredictionAccuracyLocked } from '@/components/dashboard/prediction-accuracy-locked';
import { NicheDistribution } from '@/components/dashboard/niche-distribution';
import { TopPerformers } from '@/components/dashboard/top-performers';
import { BiggestMisses } from '@/components/dashboard/biggest-misses';
import { QuickCreate } from '@/components/dashboard/quick-create';
import { NextSteps } from '@/components/dashboard/next-steps';
import type { DashboardSummary } from '@/lib/dashboard/types';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/dashboard/summary')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setData(j.data);
        else setError(j.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        数据加载失败: {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">加载中...</p>;
  }

  if (data.stats.totalAnalyses === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">数据总览</h1>
        <StatsBar stats={data.stats} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <EmptyState />
          </div>
          <QuickCreate />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">数据总览</h1>
        <div className="flex gap-2">
          <Link href="/content/script/new">
            <Button size="sm" variant="outline">✏️ 写脚本 →</Button>
          </Link>
          <Link href="/content/retro-sync">
            <Button size="sm" variant="outline">抖音同步 →</Button>
          </Link>
        </div>
      </div>

      <NextSteps data={data.workflowQueue} />

      <StatsBar stats={data.stats} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <OverallScoreTrend trend={data.trend} />
        </div>
        <QuickCreate />
      </div>

      {data.calibration
        ? <CalibrationMatrix data={data.calibration} />
        : <CalibrationLocked sampleCount={data.stats.retroedCount} />}

      {data.predictionAccuracy
        ? <PredictionAccuracy data={data.predictionAccuracy} />
        : <PredictionAccuracyLocked />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <NicheDistribution rows={data.nicheDistribution} />
        <TopPerformers items={data.topPerformers} />
        <BiggestMisses items={data.biggestMisses} />
      </div>
    </div>
  );
}
