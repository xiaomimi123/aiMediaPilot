import { ok } from '@/lib/api';
import { readCollectStatus, readScanStatus, readTopicsStatus } from '@/lib/douyin/collect-log';
import { createTaskDeps, getSchedule, isTaskRunning, manualRunsLeft, NIGHTLY_TASKS, type TaskKey } from '@/lib/tasks/nightly';

export const dynamic = 'force-dynamic';

export interface TaskView {
  key: TaskKey;
  label: string;
  schedule: { enabled: boolean; hour: number; minute: number };
  running: boolean;
  state: string;
  lastSuccessAt: string | null;
  lastMessage: string | null;
  hint: string;
  manualLeft: number;
}

export async function GET() {
  const d = createTaskDeps();
  const statuses = { collect: await readCollectStatus(), scan: await readScanStatus(), topics: await readTopicsStatus() };
  const views: TaskView[] = [];
  for (const key of Object.keys(NIGHTLY_TASKS) as TaskKey[]) {
    const s = statuses[key];
    views.push({
      key,
      label: NIGHTLY_TASKS[key].label,
      schedule: await getSchedule(d, key),
      running: await isTaskRunning(d, key),
      state: s.state,
      lastSuccessAt: s.lastSuccessAt,
      lastMessage: s.lastRun?.message ?? null,
      hint: s.hint,
      manualLeft: await manualRunsLeft(d, key),
    });
  }
  return ok(views);
}
