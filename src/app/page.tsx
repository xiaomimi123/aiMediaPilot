import { prisma } from '@/lib/prisma';
import { loadOverview } from '@/lib/overview/load';
import { TodayPanel } from '@/components/overview/today-panel';
import { MetricCards } from '@/components/overview/metric-cards';
import { TrendChart } from '@/components/overview/trend-chart';
import { WorksTable } from '@/components/overview/works-table';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const data = await loadOverview(prisma, new Date());
  return (
    <div className="h-full overflow-y-auto px-5 py-8 md:px-10">
      <h1 className="page-title mb-7">总览</h1>
      <div className="space-y-4">
        <TodayPanel data={data} />
        <MetricCards m={data.metrics} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TrendChart trend={data.trend} recordedDays={data.trendDays} />
          <WorksTable rows={data.works} />
        </div>
      </div>
    </div>
  );
}
