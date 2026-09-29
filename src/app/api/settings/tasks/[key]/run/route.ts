import { ok, fail } from '@/lib/api';
import { createTaskDeps, isTaskKey, startManualRun } from '@/lib/tasks/nightly';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { key: string } }) {
  if (!isTaskKey(params.key)) return fail('没有这个任务', 404);
  const r = await startManualRun(createTaskDeps(), params.key);
  return r.ok ? ok({ left: r.left }) : fail(r.reason, 429);
}
