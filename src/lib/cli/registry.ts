import { Prisma, type PrismaClient } from '@prisma/client';
import { EgoUnavailableError } from '@/lib/ego';
import { DouyinLoginError, DouyinRejectedError } from '@/lib/benchmark/parse';

/**
 * mp 命令行内核。给人(默认中文)和给 agent(--json)用同一套命令。
 * 权限按调用者(MP_AGENT)区分, 只防误操作, 不是安全隔离 —— Hermes 本身能执行任意命令。
 */
export type Tier = 'read' | 'write' | 'douyin' | 'heavy';
export type Agent = 'claude-code' | 'hermes';
export type ErrorCode = 'not_found' | 'bad_args' | 'forbidden' | 'db_down' | 'no_deepseek_key' | 'ego_unavailable' | 'douyin_rejected' | 'quota' | 'running' | 'failed';

export class CliError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export interface Parsed {
  positionals: string[];
  flags: Record<string, string | true>;
}

export interface CommandCtx {
  db: PrismaClient;
  agent: Agent;
  now: Date;
  /** 进度/子进程输出, 一律写 stderr(保证 --json 时 stdout 只有一行) */
  progress(line: string): void;
  /** 流式正文(如编导回复), 只在非 json 模式写 stdout */
  write(chunk: string): void;
}

export interface Command {
  path: string[];
  tier: Tier;
  hermes: boolean;
  usage: string;
  summary: string;
  run(ctx: CommandCtx, p: Parsed): Promise<unknown>;
  format?(data: unknown): string;
}

export function agentFromEnv(env: { MP_AGENT?: string }): Agent {
  return env.MP_AGENT === 'hermes' ? 'hermes' : 'claude-code';
}

export function parseArgv(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else positionals.push(a);
  }
  return { positionals, flags };
}

export function needArg(p: Parsed, i: number, name: string): string {
  const v = p.positionals[i];
  if (v === undefined || v === '') throw new CliError('bad_args', `缺少参数：${name}`);
  return v;
}

export function toCliError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (e instanceof Prisma.PrismaClientInitializationError) return new CliError('db_down', '连不上数据库：打开 Docker Desktop，然后在项目目录运行 docker compose up -d。');
  if (e instanceof EgoUnavailableError || e instanceof DouyinLoginError) return new CliError('ego_unavailable', e.message);
  if (e instanceof DouyinRejectedError) return new CliError('douyin_rejected', e.message);
  return new CliError('failed', e instanceof Error ? e.message : String(e));
}

export function helpText(cmds: Command[], agent: Agent): string {
  const usable = cmds.filter((c) => agent !== 'hermes' || c.hermes);
  return ['MediaPilot 命令行（加 --json 输出给程序读）', ...usable.map((c) => `  ${c.usage.padEnd(52)} ${c.summary}`)].join('\n');
}

function findCommand(cmds: Command[], positionals: string[]): { cmd: Command; rest: string[] } | null {
  let best: { cmd: Command; rest: string[] } | null = null;
  for (const c of cmds) {
    if (c.path.every((seg, i) => positionals[i] === seg) && (!best || c.path.length > best.cmd.path.length)) {
      best = { cmd: c, rest: positionals.slice(c.path.length) };
    }
  }
  return best;
}

export async function execute(cmds: Command[], argv: string[], env: { agent: Agent }, deps: { db: PrismaClient; now?: Date }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const parsed = parseArgv(argv);
  const json = parsed.flags.json === true;
  let stdout = '';
  let stderr = '';
  const fail = (e: CliError, cmd?: Command) => {
    if (json) stdout += `${JSON.stringify({ ok: false, error: { code: e.code, message: e.message } })}\n`;
    else stderr += `✗ ${e.message}${e.code === 'bad_args' && cmd ? `\n用法：${cmd.usage}` : ''}\n`;
    return { exitCode: e.exitCode, stdout, stderr };
  };
  if (parsed.positionals.length === 0 || parsed.positionals[0] === 'help') {
    const text = helpText(cmds, env.agent);
    stdout += json ? `${JSON.stringify({ ok: true, data: { help: text } })}\n` : `${text}\n`;
    return { exitCode: 0, stdout, stderr };
  }
  const found = findCommand(cmds, parsed.positionals);
  if (!found) return fail(new CliError('bad_args', `没有这个命令：${parsed.positionals.join(' ')}。运行 mp help 看可用命令。`));
  const { cmd, rest } = found;
  if (env.agent === 'hermes' && !cmd.hermes) return fail(new CliError('forbidden', `Hermes 不能做「${cmd.summary}」，这个要回电脑上做。`, 2), cmd);
  const ctx: CommandCtx = {
    db: deps.db,
    agent: env.agent,
    now: deps.now ?? new Date(),
    progress: (line) => {
      stderr += `${line}\n`;
    },
    write: (chunk) => {
      if (!json) stdout += chunk;
    },
  };
  try {
    const data = await cmd.run(ctx, { positionals: rest, flags: parsed.flags });
    if (json) stdout += `${JSON.stringify({ ok: true, data })}\n`;
    else if (cmd.format) stdout += `${cmd.format(data)}\n`;
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    return fail(toCliError(e), cmd);
  }
}
