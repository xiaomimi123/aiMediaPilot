import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { createDeepSeekChatModel } from '@/lib/agent/chat-model';
import { runAgentTurn, type AgentEvent } from '@/lib/agent/loop';
import { encodeSse } from '@/lib/agent/sse';
import { SCRIPT_TOOLS } from '@/lib/tools';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return fail('消息是空的', 400);
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return fail('项目不存在或已删除', 404);
  const apiKey = getDeepSeekKey();
  if (!apiKey) return fail('还没配置 DeepSeek key：在项目根目录的 .env 里填 DEEPSEEK_API_KEY，然后重启 npm run dev', 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(encodeSse(e)));
      try {
        await runAgentTurn({
          projectId: project.id,
          userText: text,
          db: prisma,
          model: createDeepSeekChatModel(apiKey),
          tools: SCRIPT_TOOLS,
          toolCtx: { projectId: project.id, db: prisma, llm: new DeepSeekTextLLM({ apiKey }) },
          emit,
        });
      } catch (e) {
        emit({ type: 'error', message: `这一轮出错了：${e instanceof Error ? e.message : String(e)}。再发一次试试。` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
