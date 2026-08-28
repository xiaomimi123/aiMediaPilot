import { PageShell } from '@/components/layout/page-shell';
import { PersonaForm } from '@/components/settings/persona-form';
import { SettingsBack } from '@/components/settings/back';
import { loadJson } from '@/lib/settings/load';
import type { PersonaProfileData } from '@/lib/persona/profile';

export const dynamic = 'force-dynamic';

export default async function PersonaSettingsPage() {
  const data = await loadJson<PersonaProfileData & { established: boolean }>(
    '/api/v1/persona/profile',
  );
  if (!data) {
    return (
      <PageShell title="账号定位" description="读取档案失败。">
        <p className="text-sm text-muted-foreground">刷新试试；一直失败就是接口挂了。</p>
      </PageShell>
    );
  }
  // established 是路由派生出来的, 不属于档案本身 —— 带着它 PUT 回去没有意义
  const { established: _established, ...profile } = data;

  return (
    <PageShell
      title="账号定位"
      description="你在对谁说话、反复讲什么、不碰什么。这份档案会注入雷达打分、选题和写稿三处 prompt。"
      actions={<SettingsBack />}
    >
      <PersonaForm initial={profile} />
    </PageShell>
  );
}
