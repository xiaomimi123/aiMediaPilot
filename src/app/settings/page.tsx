import { getDeepSeekKey } from '@/lib/env';
import { maskKey } from '@/lib/settings/deepseek';
import { DeepSeekKey } from '@/components/settings/deepseek-key';
import { HealthPanel } from '@/components/settings/health-panel';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">设置</h1>
      <div className="max-w-3xl space-y-4">
        <HealthPanel />
        <DeepSeekKey initialMasked={maskKey(getDeepSeekKey())} />
      </div>
    </div>
  );
}
