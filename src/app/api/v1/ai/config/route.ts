import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { decrypt, encrypt, maskKey } from '@/lib/crypto';
import { ok, fail } from '@/lib/api';
import { AI_PROVIDERS } from '@/lib/constants';

const ALLOWED_PROVIDERS = AI_PROVIDERS.map((p) => p.id) as string[];

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const configs = await prisma.aIConfig.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  // 不返回密钥明文,只展示掩码
  const safe = configs.map((c) => {
    let masked = '****';
    try {
      masked = maskKey(decrypt(c.apiKey));
    } catch {
      // ENCRYPTION_KEY 不匹配或数据损坏,fallthrough
    }
    return {
      id: c.id,
      provider: c.provider,
      modelId: c.modelId,
      isDefault: c.isDefault,
      createdAt: c.createdAt,
      apiKeyMasked: masked,
    };
  });
  return ok(safe);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    provider?: string;
    modelId?: string;
    apiKey?: string;
    isDefault?: boolean;
  } | null;

  if (!body?.provider || !body.modelId || !body.apiKey) {
    return fail('provider, modelId, apiKey 必填');
  }
  if (!ALLOWED_PROVIDERS.includes(body.provider)) {
    return fail(`暂不支持 provider=${body.provider},当前仅: ${ALLOWED_PROVIDERS.join(',')}`);
  }

  const user = await getOrCreateDefaultUser();
  const encrypted = encrypt(body.apiKey);

  // 如果设为默认,先把其他同 provider 取消默认
  if (body.isDefault) {
    await prisma.aIConfig.updateMany({
      where: { userId: user.id },
      data: { isDefault: false },
    });
  }

  const saved = await prisma.aIConfig.upsert({
    where: { userId_provider: { userId: user.id, provider: body.provider } },
    update: { apiKey: encrypted, modelId: body.modelId, isDefault: !!body.isDefault },
    create: {
      userId: user.id,
      provider: body.provider,
      modelId: body.modelId,
      apiKey: encrypted,
      isDefault: !!body.isDefault,
    },
  });

  return ok({ id: saved.id });
}
