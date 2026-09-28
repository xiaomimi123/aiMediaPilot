import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { writeEnvKey } from '@/lib/settings/env-file';
import { isValidDeepSeekKey, maskKey, testDeepSeekKey } from '@/lib/settings/deepseek';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({ masked: maskKey(getDeepSeekKey()) });
}

export async function PUT(req: Request) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key || !isValidDeepSeekKey(key)) return fail('key 格式不对：应以 sk- 开头，后面是字母和数字', 400);
  await writeEnvKey('DEEPSEEK_API_KEY', key.trim());
  return ok({ masked: maskKey(key.trim()) });
}

export async function POST(req: Request) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const k = key?.trim() || getDeepSeekKey();
  if (!k) return fail('还没有 key 可以测试', 400);
  return ok(await testDeepSeekKey(k));
}
