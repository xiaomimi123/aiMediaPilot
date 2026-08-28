import { PageShell } from '@/components/layout/page-shell';
import { VoiceForm } from '@/components/settings/voice-form';
import { SettingsBack } from '@/components/settings/back';
import { loadJson } from '@/lib/settings/load';
import type { CreatorVoiceData } from '@/lib/persona/voice';

export const dynamic = 'force-dynamic';

export default async function VoiceSettingsPage() {
  const data = await loadJson<CreatorVoiceData & { established: boolean }>('/api/v1/voice/profile');
  if (!data) {
    return (
      <PageShell title="我的口吻" description="读取档案失败。">
        <p className="text-sm text-muted-foreground">刷新试试；一直失败就是接口挂了。</p>
      </PageShell>
    );
  }
  const { established: _established, ...voice } = data;

  return (
    <PageShell
      title="我的口吻"
      description="定位说的是讲什么，口吻说的是谁在讲。定位能被同行抄走，口吻抄不走。"
      actions={<SettingsBack />}
    >
      <VoiceForm initial={voice} />
    </PageShell>
  );
}
