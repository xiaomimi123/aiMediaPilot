import { PageShell } from '@/components/layout/page-shell';
import { RadarForm } from '@/components/settings/radar-form';
import { SettingsBack } from '@/components/settings/back';
import { loadJson } from '@/lib/settings/load';

export const dynamic = 'force-dynamic';

interface Keyword { id: string; text: string; status: string; source: string }

export default async function RadarSettingsPage() {
  const [grouped, config] = await Promise.all([
    loadJson<Record<string, Keyword[]>>('/api/v1/radar/keywords'),
    loadJson<{ hasKey: boolean; dailyLimit: number; enabled: boolean }>('/api/v1/radar/config'),
  ]);

  const keywords = grouped
    ? [...(grouped.active ?? []), ...(grouped.candidate ?? []), ...(grouped.ignored ?? [])]
    : [];

  return (
    <PageShell
      title="雷达"
      description="关键词决定选题栏里出现什么。抓到不相干或英文内容，根源在这里，不在打分。"
      actions={<SettingsBack />}
    >
      <RadarForm
        initialKeywords={keywords}
        initialConfig={config ?? { hasKey: false, dailyLimit: 20, enabled: false }}
      />
    </PageShell>
  );
}
