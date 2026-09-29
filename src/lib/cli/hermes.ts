import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { CliError, type Command } from './registry';

export const BRIEF_JOB_NAME = 'MediaPilot 每日简报';
export const BRIEF_SCRIPT = 'mediapilot-brief.sh';

export interface HermesDeps {
  hermesHome: string;
  projectDir: string;
  /** 当前 node/npm 所在目录: 定时任务跑在非登录 shell 里, PATH 里未必有 npm */
  nodeBinDir: string;
  exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  now(): Date;
}

/** hermes cron list 的输出: 每个任务一行 "  <id> [状态]", 下面缩进 "Name: <名称>" */
export function findJobId(listOutput: string, name: string): string | null {
  let current: string | null = null;
  for (const line of listOutput.split('\n')) {
    const head = /^\s{2}([0-9a-f]{8,})\s+\[/.exec(line);
    if (head) current = head[1];
    const nm = /^\s+Name:\s+(.*)$/.exec(line);
    if (nm && current && nm[1].trim() === name) return current;
  }
  return null;
}

export async function installHermes(d: HermesDeps, opts: { hour: number; minute: number; deliver: string }) {
  // 先确认 hermes 能用, 再动任何文件
  const list = await d.exec('hermes', ['cron', 'list', '--all']);
  if (list.code !== 0) throw new CliError('failed', `找不到 hermes 命令或它没响应（${(list.stderr || list.stdout).trim().slice(0, 120) || '无输出'}）。先确认终端里能运行 hermes。`);
  const existing = findJobId(list.stdout, BRIEF_JOB_NAME);
  const skillDir = path.join(d.hermesHome, 'skills', 'mediapilot');
  let backup: string | null = null;
  if (await fs.stat(skillDir).catch(() => null)) {
    backup = `${skillDir}.bak-${d.now().toISOString().replace(/[:.]/g, '-')}`;
    await fs.rename(skillDir, backup);
  }
  await fs.cp(path.join(d.projectDir, 'agents', 'hermes', 'mediapilot'), skillDir, { recursive: true });

  const scriptsDir = path.join(d.hermesHome, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });
  const script = `#!/bin/bash
# MediaPilot 每日简报(由 mp agents install-hermes 生成). 输出原样投递, 不经过大模型.
export PATH="${d.nodeBinDir}:$PATH"
cd "${d.projectDir}" || exit 1
MP_AGENT=hermes npm run -s mp -- brief
`;
  await fs.writeFile(path.join(scriptsDir, BRIEF_SCRIPT), script, { mode: 0o755 });

  // 先建新的, 成功了再删旧的: 建失败时旧任务还在
  const r = await d.exec('hermes', ['cron', 'create', `${opts.minute} ${opts.hour} * * *`, '--name', BRIEF_JOB_NAME, '--script', BRIEF_SCRIPT, '--no-agent', '--deliver', opts.deliver]);
  if (r.code !== 0) throw new CliError('failed', `Hermes 定时任务没建上（旧任务保留）：${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  if (existing) await d.exec('hermes', ['cron', 'remove', existing]);
  return { skillDir, backup, jobReplaced: !!existing };
}

function realExec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      resolve({ code: !e ? 0 : typeof e.code === 'number' ? e.code : 127, stdout: String(stdout), stderr: String(stderr) || (e ? e.message : '') });
    });
  });
}

export const AGENTS_COMMAND: Command = {
  path: ['agents', 'install-hermes'],
  tier: 'write',
  hermes: false,
  usage: 'mp agents install-hermes [--time 08:30] [--deliver all]',
  summary: '安装 Hermes skill 与每日简报定时任务',
  async run(_ctx, p) {
    const time = typeof p.flags.time === 'string' ? p.flags.time : '08:30';
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new CliError('bad_args', '--time 写成 HH:MM，如 08:30');
    const deliver = typeof p.flags.deliver === 'string' ? p.flags.deliver : 'all';
    return installHermes(
      { hermesHome: path.join(os.homedir(), '.hermes'), projectDir: process.cwd(), nodeBinDir: path.dirname(process.execPath), exec: realExec, now: () => new Date() },
      { hour: Number(m[1]), minute: Number(m[2]), deliver },
    );
  },
  format: (d) => {
    const r = d as { skillDir: string; backup: string | null; jobReplaced: boolean };
    return [`已安装 skill：${r.skillDir}`, r.backup ? `旧 skill 已备份到：${r.backup}` : '', r.jobReplaced ? '已更新每日简报定时任务' : '已创建每日简报定时任务', '手动触发一次：hermes cron list 找到任务 id 后 hermes cron run <id>'].filter(Boolean).join('\n');
  },
};
