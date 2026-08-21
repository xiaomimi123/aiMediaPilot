import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { decrypt, encrypt, maskKey } from '@/lib/crypto';
import { ok, fail } from '@/lib/api';

const DEFAULT_RESOURCE_ID = 'seed-tts-2.0';
const DEFAULT_VOICE_TYPE = 'zh_female_vv_uranus_bigtts';

/**
 * 火山 TTS 配置 — 单条记录 (`@@unique([userId])`),与 AIConfig 的
 * userId+provider 多条列表不同。真实契约见 Task 9 报告: 鉴权是单一 `apiKey`
 * (非 spec 最初假设的 appId+accessToken 二元组), 另需账号相关的 `resourceId`
 * (资源档位/计费档, 默认 'seed-tts-2.0') 与 `voiceType` (音色, 默认
 * 'zh_female_vv_uranus_bigtts', 与 resourceId 强绑定)。
 */
export async function GET() {
  const user = await getOrCreateDefaultUser();
  const config = await prisma.volcTtsConfig.findUnique({ where: { userId: user.id } });

  if (!config) {
    return ok({
      hasConfig: false,
      resourceId: DEFAULT_RESOURCE_ID,
      voiceType: DEFAULT_VOICE_TYPE,
      apiKeyMasked: '',
    });
  }

  let masked = '****';
  try {
    masked = maskKey(decrypt(config.apiKey));
  } catch {
    // ENCRYPTION_KEY 不匹配或数据损坏,fallthrough
  }

  return ok({
    hasConfig: true,
    resourceId: config.resourceId,
    voiceType: config.voiceType,
    apiKeyMasked: masked,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    apiKey?: string;
    resourceId?: string;
    voiceType?: string;
  } | null;

  if (!body?.apiKey || typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
    return fail('apiKey 必填');
  }

  const user = await getOrCreateDefaultUser();
  const encrypted = encrypt(body.apiKey);
  const resourceId = body.resourceId?.trim() || DEFAULT_RESOURCE_ID;
  const voiceType = body.voiceType?.trim() || DEFAULT_VOICE_TYPE;

  const saved = await prisma.volcTtsConfig.upsert({
    where: { userId: user.id },
    update: { apiKey: encrypted, resourceId, voiceType },
    create: { userId: user.id, apiKey: encrypted, resourceId, voiceType },
  });

  return ok({ id: saved.id });
}
