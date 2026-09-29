import { readResult } from '@/lib/ego';
import { pairWorkListPage, WORK_LIST_SCRIPT, type WorkMetricRow } from './work-list';

export async function collectWorkMetrics(deps: {
  runScript(s: string): Promise<string>;
  save(rows: WorkMetricRow[]): Promise<{ updated: number; snapshots: number }>;
}): Promise<string> {
  const pages = readResult(await deps.runScript(WORK_LIST_SCRIPT));
  if (!Array.isArray(pages)) throw new Error('work_list 没有返回页面数据');
  const rows: WorkMetricRow[] = [];
  let skipped = 0;
  for (const p of pages) {
    const r = pairWorkListPage(p);
    rows.push(...r.rows);
    skipped += r.skipped;
  }
  const s = await deps.save(rows);
  return `作品指标: ${s.updated} 条(快照 ${s.snapshots} 条, 跳过 ${skipped} 条)`;
}
