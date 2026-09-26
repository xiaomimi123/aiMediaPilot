import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { checkDuration } from '@/lib/script/duration';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import type { AgentMessage } from './chat-model';

export const HISTORY_LIMIT = 20;

const STAGE_LABEL: Record<string, string> = {
  draft: '写稿中',
  scripted: '已定稿，等待录制',
};

const RULES = `你是用户的抖音口播编导，和用户一起把一条口播稿磨到能直接开录。
工作方式：
- 还没有稿子或用户要求重写：调用 write_script。局部修改：调用 patch_script，只改相关段落。
- 稿子显示在用户屏幕中间，不要在回复里整段贴稿子；回复里说明改了什么、为什么。
- 段落编号只用于调用工具。跟用户说话时用段落的中文名（如「冷知识」），不要说 s1、s4 这类编号。
- 时长是硬约束。工具返回 durationOk=false 时，按 issues 里的数值继续用 patch_script 修；同一段最多再修 2 次，仍超标就如实告诉用户差多少秒，并问他要不要删内容。
- 不编造数字和事实；没把握的写成相对说法。
- 回复用中文，简短。`;

export function formatSystemPrompt(p: {
  title: string;
  stage: string;
  targetSec: number;
  script: unknown;
  persona: PersonaLike | null;
}): string {
  const persona = formatPersona(p.persona);
  const parsed = ScriptSchema.safeParse(p.script);
  let scriptBlock = '还没有稿子。';
  if (parsed.success) {
    const report = checkDuration(parsed.data, p.targetSec);
    const lines = parsed.data.segments.map((s, i) => {
      const r = report.segments[i];
      return `[${s.id}] ${ROLE_LABEL[s.role]}（约 ${r.estSec} 秒 / 上限 ${r.limitSec} 秒${r.over ? '，超标' : ''}）\n${s.text}`;
    });
    scriptBlock = `${lines.join('\n\n')}\n\n全片约 ${report.totalSec} 秒。${report.ok ? '时长达标。' : `\n当前问题：\n${report.issues.join('\n')}`}`;
  }
  return [
    RULES,
    persona ? `【账号定位】\n${persona}` : '',
    `【项目】${p.title}｜${STAGE_LABEL[p.stage] ?? p.stage}｜目标 ${p.targetSec} 秒`,
    `【当前稿子】\n${scriptBlock}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 每轮从库里重建, 不依赖聊天记录推断当前状态。 */
export async function buildSystemPrompt(db: PrismaClient, projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  return formatSystemPrompt({
    title: p.title,
    stage: p.stage,
    targetSec: p.targetSec,
    script: p.script,
    persona: (p.personaSnapshot as PersonaLike | null) ?? null,
  });
}

/** 最近 HISTORY_LIMIT 条, 旧→新。tool 行转成 assistant 备注(不配对 tool_call_id 发不出去), system 行不回传。 */
export async function loadHistory(db: PrismaClient, projectId: string): Promise<AgentMessage[]> {
  const rows = await db.chatMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  });
  return rows.reverse().flatMap((m): AgentMessage[] => {
    if (m.role === 'user') return [{ role: 'user', content: m.content }];
    if (m.role === 'assistant') return m.content ? [{ role: 'assistant', content: m.content }] : [];
    if (m.role === 'tool') return [{ role: 'assistant', content: `（已执行 ${m.toolName}：${m.content}）` }];
    return [];
  });
}
