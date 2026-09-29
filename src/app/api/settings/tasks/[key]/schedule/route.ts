import { ok, fail } from '@/lib/api';
import { createTaskDeps, disableSchedule, enableSchedule, getSchedule, isTaskKey } from '@/lib/tasks/nightly';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { key: string } }) {
  if (!isTaskKey(params.key)) return fail('没有这个任务', 404);
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; hour?: number; minute?: number };
  const d = createTaskDeps();
  try {
    if (body.enabled) await enableSchedule(d, params.key, Number(body.hour), Number(body.minute));
    else await disableSchedule(d, params.key);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '设置失败', 400);
  }
  return ok(await getSchedule(d, params.key));
}
