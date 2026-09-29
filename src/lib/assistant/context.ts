import type { PrismaClient } from '@prisma/client';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { formatLessons, loadActiveLessons } from '@/lib/retro/lessons';
import { READ_COMMANDS } from '@/lib/cli/commands/read';
import { listSkills, SKILLS_DIR } from './skills';

const RULES = `你是用户的抖音创作总助手，能用工具查数据、操作产品（选题、项目、复盘、写法经验、每晚任务），也能和用户讨论。
工作方式：
- 用工具查数据、做事；做完用一两句话说明做了什么、结果如何。
- 做系统提示里【可用 skill】列出的那类事之前，先调用 load_skill 读步骤，再照着做。
- 只引用工具给的数据，不编数字、不编原因；工具没给的就说"工具里没有"。
- 工具失败时，把原因和下一步用中文告诉用户。
- 出片要在 Claude Code 里做，你做不了；用户要出片就告诉他去 Claude Code 说"给 X 项目出片"。
- 提到项目时给链接 /projects/<id>，提到对标作品时给 /topics。
- 回复用中文，简短，手机上也好读。`;

export function formatAssistantPrompt(p: { persona: string; status: string; lessons: string; skills: { name: string; description: string }[] }): string {
  return [
    RULES,
    p.persona ? `【账号定位】\n${p.persona}` : '',
    `【账号概况】\n${p.status}`,
    p.lessons ? `【写法经验】\n${p.lessons}` : '',
    p.skills.length ? `【可用 skill】（做这类事前先 load_skill）\n${p.skills.map((s) => `- ${s.name}：${s.description}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function buildAssistantPrompt(db: PrismaClient, now = new Date()): Promise<string> {
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const statusCmd = READ_COMMANDS.find((c) => c.path.join(' ') === 'status')!;
  let status = '（概况读取失败）';
  try {
    status = statusCmd.format!(await statusCmd.run({ db, agent: 'claude-code', now, progress: () => {}, write: () => {} }, { positionals: [], flags: {} }));
  } catch {
    // 概况读不到不影响对话
  }
  const lessons = await loadActiveLessons(db);
  return formatAssistantPrompt({
    persona: formatPersona(persona as PersonaLike | null),
    status,
    lessons: lessons.length ? formatLessons(lessons) : '',
    skills: await listSkills(SKILLS_DIR),
  });
}
