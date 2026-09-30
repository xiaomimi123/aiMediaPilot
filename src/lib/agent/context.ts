import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { checkDuration } from '@/lib/script/duration';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import type { AgentMessage } from './chat-model';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { compareWithScript } from '@/lib/recording/compare';
import { formatReference, loadReference, type Reference } from '@/lib/benchmark/adopt';
import { formatLessons, loadActiveLessons, type LessonForPrompt } from '@/lib/retro/lessons';

export const HISTORY_LIMIT = 20;

const STAGE_LABEL: Record<string, string> = {
  draft: '写稿中',
  scripted: '已定稿，等待录制',
  recorded: '已录制，等待出片',
  final: '已出成片',
  published: '已发布',
};

const RULES = `你是用户的抖音口播编导，和用户一起把一条口播稿磨到能直接开录。
工作方式：
- 还没有稿子或用户要求重写：调用 write_script。局部修改：调用 patch_script，只改相关段落。
- 稿子显示在用户屏幕中间，不要在回复里整段贴稿子；回复里说明改了什么、为什么。
- 段落编号只用于调用工具。跟用户说话时用段落的中文名（如「冷知识」），不要说 s1、s4 这类编号。
- 时长是硬约束。工具返回 durationOk=false 时，按 issues 里的数值继续用 patch_script 修；同一段最多再修 2 次，仍超标就如实告诉用户差多少秒，并问他要不要删内容。
- 不编造数字和事实；没有出处的数字直接不写。
- 不替用户编第一人称经历、试用结果、小故事。需要亲身例子时写「【待补：你的真实经历】」，或者直接问用户。
- 用户还没定选题、让你帮忙找时：调用 suggest_topics，把 3 个选题连同理由和参考的对标简短列给用户；用户选定后再 write_script。不要自己编热点。
- 系统提示里有对标参考时：只借三样：选题、开头钩子的写法、标题思路。不照抄原句，用用户的角度讲；工具返回 copied 非空时，按 copied 里标明的段落（segmentId）用 patch_script 把这些句子换成用户自己的说法；copied 为空之前不要说已经改好。
- 有【写法经验】时：写稿遵守；和用户这次的要求冲突时听用户的。
- 用户的 Obsidian 笔记：写稿前如果这个选题可能在用户笔记里有积累，先调用 search_notes，需要时 read_note 看全文；优先用用户自己的观点、案例和经历。稿子是口播，正文里不写 [[ ]]；在回复里说明借用了哪篇，如「开场的例子来自 [[笔记名]]」。不拿笔记去编【待补】处的经历，只引用笔记里真实写着的内容。
- 用户要把这个项目存进笔记 / Obsidian：调用 propose_note（可附一两句编导小结），然后告诉用户在卡片上确认。
- 用户问这条能不能火、让你测一下时：调用 predict_views，把中枢、最可能的区间和拖后腿的项简短告诉用户；按拖后腿的建议改完可以再测一次。
- 回复用中文，简短。`;

export function formatSystemPrompt(p: {
  title: string;
  stage: string;
  targetSec: number;
  script: unknown;
  persona: PersonaLike | null;
  transcript?: { lines: { startSec: number; text: string; adlib: boolean }[]; skipped: string[] } | null;
  reference?: Reference | null;
  lessons?: LessonForPrompt[];
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
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const transcriptBlock = p.transcript
    ? `【口播转写】（用户实际录下来的话，共 ${p.transcript.lines.length} 句）\n${p.transcript.lines
        .map((l) => `[${mmss(l.startSec)}] ${l.text}${l.adlib ? '（临场加的）' : ''}`)
        .join('\n')}${p.transcript.skipped.length ? `\n没讲到的段落：${p.transcript.skipped.join('、')}` : ''}`
    : '';
  return [
    RULES,
    persona ? `【账号定位】\n${persona}` : '',
    p.lessons?.length ? `【写法经验】（来自你自己的复盘）\n${formatLessons(p.lessons)}` : '',
    `【项目】${p.title}｜${STAGE_LABEL[p.stage] ?? p.stage}｜目标 ${p.targetSec} 秒`,
    p.reference ? `【参考的对标作品】\n${formatReference(p.reference)}` : '',
    `【当前稿子】\n${scriptBlock}`,
    transcriptBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 每轮从库里重建, 不依赖聊天记录推断当前状态。 */
export async function buildSystemPrompt(db: PrismaClient, projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const parsed = ScriptSchema.safeParse(p.script);
  const t = await loadCurrentTranscript(db, projectId);
  let transcript: { lines: { startSec: number; text: string; adlib: boolean }[]; skipped: string[] } | null = null;
  if (t) {
    const cmp = parsed.success ? compareWithScript(parsed.data, t.data.lines) : null;
    transcript = {
      lines: t.data.lines.map((l, i) => ({ startSec: l.startSec, text: l.text, adlib: cmp ? cmp.lines[i].adlib : false })),
      skipped: cmp ? cmp.segments.filter((s) => s.skipped).map((s) => ROLE_LABEL[s.role]) : [],
    };
  }
  return formatSystemPrompt({
    title: p.title,
    stage: p.stage,
    targetSec: p.targetSec,
    script: p.script,
    persona: (p.personaSnapshot as PersonaLike | null) ?? null,
    transcript,
    reference: await loadReference(db, p.benchmarkVideoId ?? null),
    lessons: await loadActiveLessons(db),
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
