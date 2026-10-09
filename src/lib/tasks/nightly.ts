import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { realExec, type Exec } from '@/lib/health/checks';
import { peekDailyQuota, takeDailyQuota } from '@/lib/benchmark/quota';

/**
 * 每晚任务(作品数据回采、对标巡检)的开关与手动开跑, 给设置页用。
 * 定时靠 macOS launchd(与 scripts/install-*-cron.sh 装的是同一个 plist); 这里只在用户点开关时改。
 */
export const NIGHTLY_TASKS = {
  collect: {
    label: '作品数据回采',
    launchdLabel: 'com.mediapilot.collect-douyin',
    npmScript: 'collect:douyin',
    scriptFile: 'scripts/collect-douyin.ts',
    log: 'logs/collect-douyin.log',
    defaultHour: 20,
    defaultMinute: 0,
    /** 失败补跑: 设定时间后 60、120 分钟各再触发一次; 脚本带 --scheduled, 刚成功过就跳过 */
    retryAfterMin: [60, 120] as number[],
  },
  scan: {
    label: '对标巡检',
    launchdLabel: 'com.mediapilot.scan-benchmarks',
    npmScript: 'scan:benchmarks',
    scriptFile: 'scripts/scan-benchmarks.ts',
    log: 'logs/scan-benchmarks.log',
    defaultHour: 20,
    defaultMinute: 30,
    /** 同回采: 失败时 60、120 分钟后补跑; 脚本带 --scheduled, 刚成功过就跳过 */
    retryAfterMin: [60, 120] as number[],
  },
  topics: {
    label: '每日选题',
    launchdLabel: 'com.mediapilot.daily-topics',
    npmScript: 'topics:daily',
    scriptFile: 'scripts/daily-topics.ts',
    log: 'logs/daily-topics.log',
    defaultHour: 23,
    defaultMinute: 0,
    /** 失败时 0:00、1:00 补跑; 脚本带 --scheduled, 今天已生成过就跳过 */
    retryAfterMin: [60, 120] as number[],
  },
} as const;

export type TaskKey = keyof typeof NIGHTLY_TASKS;
type TaskDef = (typeof NIGHTLY_TASKS)[TaskKey];

/** 手动开跑每天上限(保护账号); 加上每晚定时那次, 一天最多 4 轮 */
export const MANUAL_DAILY_LIMIT = 3;

export interface TaskDeps {
  projectDir: string;
  agentsDir: string;
  exec: Exec;
  /** 后台跑 npm 脚本, 输出追加到日志; 不等它结束 */
  spawnDetached(npmScript: string, logFile: string): void;
  now(): Date;
}

export function isTaskKey(k: string): k is TaskKey {
  return k in NIGHTLY_TASKS;
}

export function renderPlist(template: string, projectDir: string, hour: number, minute: number, retryAfterMin: number[] = []): string {
  const s = template.replace(/__PROJECT_DIR__/g, projectDir);
  if (retryAfterMin.length === 0) {
    return s.replace(/(<key>Hour<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${hour}$2`).replace(/(<key>Minute<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${minute}$2`);
  }
  // 多个时间: launchd 的 StartCalendarInterval 写成数组; 第一个是设定时间(readSchedule 读它), 其后是补跑(跨午夜取模)
  const at = (m: number) => `    <dict>\n      <key>Hour</key>\n      <integer>${Math.floor(m / 60) % 24}</integer>\n      <key>Minute</key>\n      <integer>${m % 60}</integer>\n    </dict>`;
  const base = hour * 60 + minute;
  const block = `<key>StartCalendarInterval</key>\n  <array>\n${[0, ...retryAfterMin].map((d) => at((base + d) % 1440)).join('\n')}\n  </array>`;
  return s.replace(/<key>StartCalendarInterval<\/key>\s*<(dict|array)>[\s\S]*?<\/\1>/, block);
}

export function readSchedule(plist: string | null, task: TaskDef): { enabled: boolean; hour: number; minute: number } {
  if (!plist) return { enabled: false, hour: task.defaultHour, minute: task.defaultMinute };
  const num = (key: string, dflt: number) => Number(new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`).exec(plist)?.[1] ?? dflt);
  return { enabled: true, hour: num('Hour', task.defaultHour), minute: num('Minute', task.defaultMinute) };
}

const plistPath = (d: TaskDeps, t: TaskDef) => path.join(d.agentsDir, `${t.launchdLabel}.plist`);

export async function getSchedule(d: TaskDeps, key: TaskKey) {
  const t = NIGHTLY_TASKS[key];
  return readSchedule(await fsp.readFile(plistPath(d, t), 'utf8').catch(() => null), t);
}

export async function enableSchedule(d: TaskDeps, key: TaskKey, hour: number, minute: number): Promise<void> {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error('时间不对：小时 0～23，分钟 0～59');
  const t = NIGHTLY_TASKS[key];
  const template = await fsp.readFile(path.join(d.projectDir, 'scripts', `${t.launchdLabel}.plist`), 'utf8');
  await fsp.mkdir(d.agentsDir, { recursive: true });
  await fsp.mkdir(path.join(d.projectDir, 'logs'), { recursive: true });
  const file = plistPath(d, t);
  await fsp.writeFile(file, renderPlist(template, d.projectDir, hour, minute, t.retryAfterMin));
  // 先卸再装, 改过时间才会生效(卸载失败 = 本来没装, 不管)
  await d.exec('launchctl', ['unload', '-w', file], 10_000);
  const r = await d.exec('launchctl', ['load', '-w', file], 10_000);
  if (r.code !== 0) throw new Error(`系统定时任务没装上：${r.stderr.trim().slice(0, 200) || '未知原因'}`);
}

export async function disableSchedule(d: TaskDeps, key: TaskKey): Promise<void> {
  const file = plistPath(d, NIGHTLY_TASKS[key]);
  await d.exec('launchctl', ['unload', '-w', file], 10_000);
  await fsp.rm(file, { force: true });
}

/** 定时的和手动的都算: 看系统里有没有这个脚本的进程 */
export async function isTaskRunning(d: TaskDeps, key: TaskKey): Promise<boolean> {
  return (await d.exec('pgrep', ['-f', NIGHTLY_TASKS[key].scriptFile], 5_000)).code === 0;
}

const quotaFile = (d: TaskDeps, key: TaskKey) => path.join(d.projectDir, 'logs', `${key}-manual-quota.json`);

export function manualRunsLeft(d: TaskDeps, key: TaskKey): Promise<number> {
  return peekDailyQuota(quotaFile(d, key), MANUAL_DAILY_LIMIT, d.now());
}

export async function startManualRun(d: TaskDeps, key: TaskKey): Promise<{ ok: true; left: number } | { ok: false; reason: string }> {
  const t = NIGHTLY_TASKS[key];
  if (await isTaskRunning(d, key)) return { ok: false, reason: `${t.label}正在跑，等它跑完再点。` };
  if (!(await takeDailyQuota(quotaFile(d, key), MANUAL_DAILY_LIMIT, d.now()))) {
    return { ok: false, reason: `${t.label}今天已经手动跑了 ${MANUAL_DAILY_LIMIT} 次（保护账号），明天再试，或等每晚定时的那次。` };
  }
  d.spawnDetached(t.npmScript, path.join(d.projectDir, t.log));
  return { ok: true, left: await manualRunsLeft(d, key) };
}

export function createTaskDeps(): TaskDeps {
  const projectDir = process.cwd();
  return {
    projectDir,
    agentsDir: path.join(os.homedir(), 'Library', 'LaunchAgents'),
    exec: realExec,
    spawnDetached(npmScript, logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const out = fs.openSync(logFile, 'a');
      const child = spawn('npm', ['run', '-s', npmScript], { cwd: projectDir, detached: true, stdio: ['ignore', out, out] });
      child.unref();
      fs.closeSync(out);
    },
    now: () => new Date(),
  };
}
