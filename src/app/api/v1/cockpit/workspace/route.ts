import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { loadWorkspaceFromDb, saveWorkspaceToDb } from '@/lib/cockpit/server-store';
import { loadExtras } from '@/lib/cockpit/extras';

export async function GET() {
  try {
    const user = await getOrCreateDefaultUser();
    const { state, rev } = await loadWorkspaceFromDb(user.id);
    const extras = await loadExtras(user.id);
    return ok({ state, rev, extras });
  } catch (e) {
    console.error('[GET cockpit/workspace]', e);
    return fail(`加载失败: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}

export async function PUT(req: Request) {
  let body: { state?: unknown; rev?: string };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  if (!body.state || typeof body.rev !== 'string') return fail('缺少 state 或 rev', 400);
  try {
    const user = await getOrCreateDefaultUser();
    const result = await saveWorkspaceToDb(user.id, body.state as never, body.rev);
    if (!result.ok) return fail('conflict', 409);
    return ok({ rev: result.rev });
  } catch (e) {
    console.error('[PUT cockpit/workspace]', e);
    return fail(`保存失败: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
