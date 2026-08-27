import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { HOOK_PATTERNS, detectHookPattern } from '@/lib/hooks/model';
import { readActsFromDraftOutput } from '@/lib/cockpit/script-score';

const CreateSchema = z.object({
  text: z.string().min(2).max(200),
  /** 不传就自动认模式 —— 手工分类是最容易被跳过的一步。 */
  pattern: z.enum(HOOK_PATTERNS).optional(),
});

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const hooks = await prisma.hook.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return ok({ hooks });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const user = await getOrCreateDefaultUser();

  // 无 body 的 POST = 「从我的稿子里抽」
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    if ((raw as { importFromScripts?: boolean })?.importFromScripts) {
      return importFromScripts(user.id);
    }
    return fail(`钩子不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);
  }

  const text = parsed.data.text.trim();
  const hook = await prisma.hook.create({
    data: {
      userId: user.id,
      text,
      pattern: parsed.data.pattern ?? detectHookPattern(text),
      origin: 'manual',
    },
  });
  return ok({ hook });
}

/**
 * 从已有六幕稿里把开场钩子抽进库。
 *
 * 手工录入是最容易被跳过的一步 —— 而这些钩子本来就已经躺在稿子里了。按文本去重,
 * 重复导入不会堆出一堆一样的条目。
 */
async function importFromScripts(userId: string) {
  const [drafts, existing] = await Promise.all([
    prisma.scriptDraft.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, output: true },
      take: 200,
    }),
    prisma.hook.findMany({ where: { userId }, select: { text: true } }),
  ]);

  const seen = new Set(existing.map((h) => h.text));
  const rows: { userId: string; text: string; pattern: string; origin: string; scriptId: string }[] = [];

  for (const d of drafts) {
    const acts = readActsFromDraftOutput(d.output);
    const hookAct = acts?.find((a) => a.act === 'hook');
    const text = hookAct?.narration?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    rows.push({ userId, text, pattern: detectHookPattern(text), origin: 'script', scriptId: d.id });
  }

  if (rows.length > 0) await prisma.hook.createMany({ data: rows });
  return ok({ imported: rows.length });
}
