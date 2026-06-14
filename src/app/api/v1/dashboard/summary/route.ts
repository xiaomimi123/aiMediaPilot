import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { aggregateDashboard } from '@/lib/dashboard/aggregate';

export async function GET() {
  try {
    const user = await getOrCreateDefaultUser();
    const summary = await aggregateDashboard(user.id);
    return ok(summary);
  } catch (e) {
    console.error('[dashboard/summary] aggregation failed', e);
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`dashboard 加载失败: ${msg}`, 500);
  }
}
