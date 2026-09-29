import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
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
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    // 用户关页/刷新: 流被取消, 之后的事件直接丢弃, 这一轮在服务端照常跑完并存库
    cancel() {
      closed = true;
    },
    async start(controller) {
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(e)));
        } catch {
          closed = true;
        }
      };
      try {
        await runAgentTurn({
          projectId: project.id,
          userText: text,
          db: prisma,
          model: m.chat,
          tools: SCRIPT_TOOLS,
          toolCtx: { projectId: project.id, db: prisma, llm: m.llm },
          emit,
        });
      } catch (e) {
        emit({ type: 'error', message: `这一轮出错了：${e instanceof Error ? e.message : String(e)}。再发一次试试。` });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // 已被取消
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
