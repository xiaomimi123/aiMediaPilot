import { ok } from '@/lib/api';
import { readCollectStatus, readScanStatus, readTopicsStatus, readSourcesStatus } from '@/lib/douyin/collect-log';
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
  /** 失败会不会自动补跑(回采/巡检/选题会, 抓信息源不会) */
  retryAfterMin: boolean;
}

export async function GET() {
  const d = createTaskDeps();
  const statuses = { collect: await readCollectStatus(), scan: await readScanStatus(), topics: await readTopicsStatus(), sources: await readSourcesStatus() };
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
      retryAfterMin: NIGHTLY_TASKS[key].retryAfterMin.length > 0,
    });
  }
  return ok(views);
}
