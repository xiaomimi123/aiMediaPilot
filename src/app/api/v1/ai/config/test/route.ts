import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { decrypt } from '@/lib/crypto';
import { ok, fail } from '@/lib/api';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    configId?: string;
    apiKey?: string;
    provider?: string;
    modelId?: string;
  } | null;

  if (!body) return fail('请求体不合法');

  let provider = body.provider;
  let modelId = body.modelId;
  let apiKey = body.apiKey;

  // 优先用 configId,从库里取出已保存的密钥
  if (body.configId) {
    const user = await getOrCreateDefaultUser();
    const cfg = await prisma.aIConfig.findUnique({ where: { id: body.configId } });
    if (!cfg || cfg.userId !== user.id) return fail('配置不存在', 404);
    provider = cfg.provider;
    modelId = cfg.modelId;
    try {
      apiKey = decrypt(cfg.apiKey);
    } catch {
      return fail('密钥解密失败,可能 ENCRYPTION_KEY 已变更', 500);
    }
  }

  if (!provider || !modelId || !apiKey) {
    return fail('provider/modelId/apiKey 必填,或提供 configId');
  }

  if (provider !== 'openai') {
    return fail(`暂仅支持测试 openai,收到: ${provider}`);
  }

  try {
    const client = new OpenAI({ apiKey });
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    return ok({
      ok: true,
      model: res.model,
      reply: res.choices[0]?.message?.content ?? '',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`连通性测试失败: ${msg}`, 502);
  }
}
