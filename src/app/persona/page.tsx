import { prisma } from '@/lib/prisma';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';
import { PersonaEditor } from '@/components/persona/persona-editor';

export const dynamic = 'force-dynamic';

export default async function PersonaPage() {
  const row = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const parsed = row ? PersonaSchema.safeParse(row) : null;
  const initial = parsed?.success ? parsed.data : EMPTY_PERSONA;
  const broken = parsed !== null && !parsed.success;
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">定位</h1>
      {broken && <p className="mb-3 text-sm text-[var(--warning)]">旧档案格式不完整，已按空白显示。保存会覆盖旧档案。</p>}
      <PersonaEditor initial={initial} />
    </div>
  );
}
