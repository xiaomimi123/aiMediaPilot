import { PageShell } from '@/components/layout/page-shell';
import { AiForm } from '@/components/settings/ai-form';
import { SettingsBack } from '@/components/settings/back';
import { loadJson } from '@/lib/settings/load';

export const dynamic = 'force-dynamic';

interface Config {
  id: string; provider: string; modelId: string; isDefault: boolean; apiKeyMasked: string;
}

export default async function AiSettingsPage() {
  const [configs, tts] = await Promise.all([
    loadJson<Config[]>('/api/v1/ai/config'),
    loadJson<{ hasConfig: boolean; resourceId: string; voiceType: string }>('/api/v1/tts/volc-config'),
  ]);

  return (
    <PageShell
      title="模型与密钥"
      description="密钥加密存库，只回显掩码。配错的症状是生成时报一个看不懂的错，所以每条都能当场测一下。"
      actions={<SettingsBack />}
    >
      <AiForm
        initialConfigs={configs ?? []}
        initialTts={tts ?? { hasConfig: false, resourceId: '', voiceType: '' }}
      />
    </PageShell>
  );
}
