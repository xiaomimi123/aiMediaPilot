/**
 * web 进程内的拆解队列: 一次一条(本地转写吃满 CPU, 并发只会一起变慢)。
 * 放在 globalThis 上, dev 热更新不丢队列。服务重启后队列清空 —— 残留的 running 由列表接口改成失败(见 Task 8)。
 */
type Q = { chain: Promise<void>; active: Set<string> };
const g = globalThis as unknown as { __mpAnalysisQueue?: Q };
const q: Q = (g.__mpAnalysisQueue ??= { chain: Promise.resolve(), active: new Set() });

export function isAnalysisActive(videoId: string): boolean {
  return q.active.has(videoId);
}

export function enqueueAnalysis(videoId: string, run: (id: string) => Promise<unknown>): boolean {
  if (q.active.has(videoId)) return false;
  q.active.add(videoId);
  q.chain = q.chain
    .then(async () => {
      await run(videoId);
    })
    .catch(() => {})
    .finally(() => {
      q.active.delete(videoId);
    });
  return true;
}
