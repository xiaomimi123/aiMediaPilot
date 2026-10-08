import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 每晚回采(launchd)只写日志, 不写库状态。首页靠解析日志判断回采是否健康 ——
 * 09-25 数据库停了两天、回采静默失败, 就是因为失败只写进了日志。
 */
export const STALE_HOURS = 36;

export interface CollectRun {
  startedAt: string;
  ok: boolean;
  message: string;
}
export interface CollectStatus {
  state: 'never' | 'ok' | 'failing' | 'stale';
  lastRun: CollectRun | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  hint: string;
}

/** 每晚任务的日志约定: 以 start 开头的行开始一次运行, 出现 done 开头的行才算成功。回采与对标巡检共用。 */
export interface RunLogSpec {
  start: string;
  done: string;
  noun: string;
  install: string;
  checkCmd: string;
}

export const COLLECT_SPEC: RunLogSpec = {
  start: '开始回采',
  done: '回采完成',
  noun: '回采',
  install: '在项目目录运行 sh scripts/install-collect-cron.sh 装上每晚 20:00 的回采，或先手动运行 npm run collect:douyin。',
  checkCmd: 'launchctl list | grep mediapilot',
};

export const SCAN_SPEC: RunLogSpec = {
  start: '开始巡检',
  done: '巡检完成',
  noun: '对标巡检',
  install: '在项目目录运行 sh scripts/install-scan-cron.sh 装上每晚 20:30 的对标巡检，或先手动运行 npm run scan:benchmarks。',
  checkCmd: 'launchctl list | grep scan-benchmarks',
};

export function parseRunLog(text: string, now: Date, spec: RunLogSpec): CollectStatus {
  const runs: { startedAt: string; lines: { at: string; msg: string }[] }[] = [];
  let pendingReason: { at: string; msg: string } | null = null;
  for (const raw of text.split('\n')) {
    const m = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] (.*)$/.exec(raw.trim());
    if (!m) {
      // npm 输出、shell 报错、堆栈行都跳过; 例外: "未预期的错误"只有首行带时间(类名), 真正原因在下一行
      const line = raw.trim();
      if (pendingReason && line && !line.startsWith('at ')) {
        pendingReason.msg = `未预期的错误：${line}`;
        pendingReason = null;
      }
      continue;
    }
    pendingReason = null;
    const [, at, msg] = m;
    if (msg.startsWith(spec.start)) runs.push({ startedAt: at, lines: [] });
    else if (runs.length) {
      const entry = { at, msg: msg.trim() };
      if (entry.msg.startsWith('未预期的错误')) {
        entry.msg = '未预期的错误（日志里没有写原因）';
        pendingReason = entry;
      }
      runs[runs.length - 1].lines.push(entry);
    }
  }
  if (runs.length === 0) return { state: 'never', lastRun: null, lastSuccessAt: null, consecutiveFailures: 0, hint: `还没有${spec.noun}记录。${spec.install}` };

  const done = runs.map((r) => {
    const okLine = r.lines.find((l) => l.msg.startsWith(spec.done));
    return {
      startedAt: r.startedAt,
      ok: !!okLine,
      message: okLine?.msg ?? r.lines[r.lines.length - 1]?.msg ?? `${spec.noun}中途中断，没有留下原因`,
      okAt: okLine?.at ?? null,
    };
  });
  const last = done[done.length - 1];
  let consecutiveFailures = 0;
  for (let i = done.length - 1; i >= 0 && !done[i].ok; i--) consecutiveFailures++;
  const lastSuccess = [...done].reverse().find((r) => r.ok);
  const lastSuccessAt = lastSuccess?.okAt ?? null;
  const lastRun: CollectRun = { startedAt: last.startedAt, ok: last.ok, message: last.message };

  if (!last.ok) {
    const fix = /reach database server|ECONNREFUSED/i.test(last.message) ? '（数据库没启动：打开 Docker Desktop，然后运行 docker compose up -d）' : '';
    return { state: 'failing', lastRun, lastSuccessAt, consecutiveFailures, hint: `连续 ${consecutiveFailures} 次${spec.noun}失败：${last.message}${fix}` };
  }
  const hours = (now.getTime() - new Date(lastSuccessAt!).getTime()) / 3600_000;
  if (hours > STALE_HOURS) {
    return { state: 'stale', lastRun, lastSuccessAt, consecutiveFailures: 0, hint: `超过 36 小时没有成功${spec.noun}（上次 ${Math.floor(hours)} 小时前）。检查定时任务是否还在：${spec.checkCmd}` };
  }
  return { state: 'ok', lastRun, lastSuccessAt, consecutiveFailures: 0, hint: '' };
}

/** 定时补跑: 这么多小时内回采成功过就跳过(不开浏览器、不访问抖音) */
export const RETRY_SKIP_HOURS = 6;

export function shouldSkipScheduledCollect(status: CollectStatus, now: Date): boolean {
  if (status.state === 'failing' || !status.lastSuccessAt) return false;
  return now.getTime() - new Date(status.lastSuccessAt).getTime() < RETRY_SKIP_HOURS * 3600_000;
}

export function parseCollectLog(text: string, now: Date): CollectStatus {
  return parseRunLog(text, now, COLLECT_SPEC);
}

async function readRunStatus(file: string, now: Date, spec: RunLogSpec): Promise<CollectStatus> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return { state: 'never', lastRun: null, lastSuccessAt: null, consecutiveFailures: 0, hint: `还没有${spec.noun}日志。${spec.install}` };
  return parseRunLog(text, now, spec);
}

export function readCollectStatus(now = new Date(), file = path.join(process.cwd(), 'logs', 'collect-douyin.log')): Promise<CollectStatus> {
  return readRunStatus(file, now, COLLECT_SPEC);
}

export function readScanStatus(now = new Date(), file = path.join(process.cwd(), 'logs', 'scan-benchmarks.log')): Promise<CollectStatus> {
  return readRunStatus(file, now, SCAN_SPEC);
}
