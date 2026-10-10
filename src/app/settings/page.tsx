import { prisma } from '@/lib/prisma';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';
import { PersonaEditor } from '@/components/persona/persona-editor';
import { ModelsCard } from '@/components/settings/models-card';
import { HealthPanel } from '@/components/settings/health-panel';
import { NightlyTasks } from '@/components/settings/nightly-tasks';
import { ObsidianCard } from '@/components/settings/obsidian-card';
import { LessonsCard } from '@/components/settings/lessons-card';
import { VoiceSamplesCard } from '@/components/settings/voice-samples-card';
import { FormulaCard } from '@/components/retro/formula-card';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'persona', label: '账号定位' },
  { id: 'voice', label: '说话样本' },
  { id: 'models', label: '模型' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'tasks', label: '每晚任务' },
  { id: 'lessons', label: '写法库' },
  { id: 'formula', label: '预测公式' },
  { id: 'health', label: '依赖体检' },
];

export default async function SettingsPage() {
  const row = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const parsed = row ? PersonaSchema.safeParse(row) : null;
  const persona = parsed?.success ? parsed.data : EMPTY_PERSONA;
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="mb-3 text-[22px] font-bold">设置</h1>
      <nav className="sticky top-0 z-10 -mx-4 mb-4 flex gap-2 overflow-x-auto bg-[var(--bg-canvas)] px-4 py-2 md:-mx-8 md:px-8">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="chip shrink-0">{s.label}</a>
        ))}
      </nav>
      <div className="max-w-3xl space-y-4">
        <section id="persona" className="card scroll-mt-16">
          <h3 className="mb-3 text-[15px] font-semibold">账号定位</h3>
          {parsed !== null && !parsed.success && <p className="mb-3 text-sm text-[var(--warning)]">旧档案格式不完整，已按空白显示。保存会覆盖旧档案。</p>}
          <PersonaEditor initial={persona} />
        </section>
        <div id="voice" className="scroll-mt-16"><VoiceSamplesCard /></div>
        <div id="models" className="scroll-mt-16"><ModelsCard /></div>
        <div id="obsidian" className="scroll-mt-16"><ObsidianCard /></div>
        <div id="tasks" className="scroll-mt-16"><NightlyTasks /></div>
        <div id="lessons" className="scroll-mt-16"><LessonsCard /></div>
        <section id="formula" className="card scroll-mt-16">
          <h3 className="mb-1 text-[15px] font-semibold">预测公式</h3>
          <p className="mb-2 text-xs text-[var(--text-secondary)]">同一项连续 3 次往同一方向偏、并且回测更准时，这里会出现调整建议。</p>
          <FormulaCard />
        </section>
        <div id="health" className="scroll-mt-16"><HealthPanel /></div>
      </div>
    </div>
  );
}
