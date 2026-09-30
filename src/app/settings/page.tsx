import { ModelsCard } from '@/components/settings/models-card';
import { HealthPanel } from '@/components/settings/health-panel';
import { NightlyTasks } from '@/components/settings/nightly-tasks';
import { ObsidianCard } from '@/components/settings/obsidian-card';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">设置</h1>
      <div className="max-w-3xl space-y-4">
        <HealthPanel />
        <ModelsCard />
        <ObsidianCard />
        <NightlyTasks />
      </div>
    </div>
  );
}
