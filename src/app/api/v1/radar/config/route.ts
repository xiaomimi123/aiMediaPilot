import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { getRadarConfig, saveRadarConfig } from '@/lib/radar/config';

/** GET — 掩码语义循 AIConfig: 只回 {hasKey, dailyLimit, enabled}，绝不回显 key 明文/密文。 */
export async function GET() {
  const user = await getOrCreateDefaultUser();
  const config = await getRadarConfig(user.id);
  return ok(config);
}

/** PUT — 部分更新，走 saveRadarConfig (未传字段保持原值不变；tavilyKey 传空串 = 显式清空)。 */
export async function PUT(req: Request) {
  let body: { tavilyKey?: unknown; dailyLimit?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const patch: { tavilyKey?: string; dailyLimit?: number; enabled?: boolean } = {};
  if (body.tavilyKey !== undefined) {
    if (typeof body.tavilyKey !== 'string') return fail('tavilyKey 需为字符串', 400);
    patch.tavilyKey = body.tavilyKey;
  }
  if (body.dailyLimit !== undefined) {
    if (typeof body.dailyLimit !== 'number' || !Number.isInteger(body.dailyLimit) || body.dailyLimit < 1) {
      return fail('dailyLimit 需为正整数', 400);
    }
    patch.dailyLimit = body.dailyLimit;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return fail('enabled 需为布尔值', 400);
    patch.enabled = body.enabled;
  }

  const user = await getOrCreateDefaultUser();
  try {
    await saveRadarConfig(user.id, patch);
    const config = await getRadarConfig(user.id);
    return ok(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PUT radar/config]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
