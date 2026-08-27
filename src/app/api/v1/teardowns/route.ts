import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { TEARDOWN } from '@/lib/llm/prompts/teardown';

const CreateSchema = z.object({
  title: z.string().min(1).max(120),
  author: z.string().max(60).default(''),
  url: z.string().max(500).default(''),
  transcript: z.string().min(50).max(20000),
});

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const teardowns = await prisma.teardown.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return ok({ teardowns });
}

/**
 * 拆一条对标视频。
 *
 * 同步跑而不是入队: 一次 DeepSeek 调用几秒钟, 而**入队意味着要 worker 在跑** ——
 * 这个项目已经因为 worker 静默不跑吃过大亏(9 次出片 0 成功)。能同步做完的事就别
 * 交给队列。
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(`拆解输入不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);
  }

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  const created = await prisma.teardown.create({
    data: { ...parsed.data, userId: user.id, status: 'pending' },
  });

  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: TEARDOWN.buildSystemPrompt('ai-knowledge'),
      userMessage: TEARDOWN.buildUserMessage(parsed.data),
      responseSchema: TEARDOWN.responseSchema,
    });
    const done = await prisma.teardown.update({
      where: { id: created.id },
      data: { result: out.result as unknown as Prisma.InputJsonObject, status: 'done' },
    });
    return ok({ teardown: done });
  } catch (e) {
    console.error('[POST teardowns]', e);
    // 失败也把记录留下并写明原因 —— 转写稿是用户贴进来的, 丢了要重贴
    await prisma.teardown.update({
      where: { id: created.id },
      data: { status: 'failed', errorMessage: e instanceof Error ? e.message.slice(0, 300) : '拆解失败' },
    });
    return fail('拆解失败，转写稿已保留，可以重试', 500);
  }
}
