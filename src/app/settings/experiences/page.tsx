import { PageShell } from '@/components/layout/page-shell';
import { ExperiencesForm } from '@/components/settings/experiences-form';
import { SettingsBack } from '@/components/settings/back';
import { loadJson } from '@/lib/settings/load';

export const dynamic = 'force-dynamic';

interface Row {
  id: string; content: string; topic: string; kind: string;
  keywords: string[]; usedCount: number; createdAt: string;
}

export default async function ExperiencesSettingsPage() {
  const data = await loadJson<{ experiences: Row[] }>('/api/v1/experiences');

  return (
    <PageShell
      title="个人经历"
      description="写稿时唯一被当作「你本人真有的材料」的来源。联网研究抓回来的是第三方信息，不许写成你的经历。"
      actions={<SettingsBack />}
    >
      <ExperiencesForm initial={data?.experiences ?? []} />
    </PageShell>
  );
}
