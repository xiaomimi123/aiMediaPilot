import { execFile } from 'node:child_process';
import path from 'node:path';
import type { CollectStatus } from '@/lib/douyin/collect-log';

export type Exec = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface HealthItem {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

/** 超时记为 code 124(与 coreutils timeout 一致); 命令不存在记为 127 */
export const realExec: Exec = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      const code = !e ? 0 : e.killed ? 124 : e.code === 'ENOENT' ? 127 : typeof e.code === 'number' ? e.code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const TIMEOUT = 8000;

/** 逐项体检本机依赖; 只读, 不修改任何东西 */
export async function runHealthChecks(deps: {
  exec: Exec;
  exists: (p: string) => Promise<boolean>;
  dbPing: () => Promise<void>;
  env: NodeJS.ProcessEnv;
  cwd: string;
  collect: CollectStatus;
  scan: CollectStatus;
}): Promise<HealthItem[]> {
  const items: HealthItem[] = [];

  try {
    await deps.dbPing();
    items.push({ key: 'db', label: '数据库', status: 'ok', detail: 'Postgres 连接正常' });
  } catch {
    // 不把 Prisma 的多行英文报错放到界面上
    items.push({ key: 'db', label: '数据库', status: 'fail', detail: '连不上数据库', fix: '启动 Docker Desktop，然后运行 docker compose up -d' });
  }

  const key = deps.env.DEEPSEEK_API_KEY?.trim();
  items.push(
    key
      ? { key: 'deepseek', label: 'DeepSeek key', status: 'ok', detail: `已配置（sk-…${key.slice(-4)}），可在下方测试连接` }
      : { key: 'deepseek', label: 'DeepSeek key', status: 'fail', detail: '没有配置，编导和写稿都用不了', fix: '在下方填入 DeepSeek key' },
  );

  const ff = await deps.exec('ffmpeg', ['-version'], TIMEOUT);
  const fp = ff.code === 0 ? await deps.exec('ffprobe', ['-version'], TIMEOUT) : ff;
  items.push(
    ff.code === 0 && fp.code === 0
      ? { key: 'ffmpeg', label: 'ffmpeg / ffprobe', status: 'ok', detail: '已安装' }
      : { key: 'ffmpeg', label: 'ffmpeg / ffprobe', status: 'fail', detail: ff.code === 124 || fp.code === 124 ? 'ffmpeg 没有响应（超时）' : '没有找到 ffmpeg 或 ffprobe', fix: 'brew install ffmpeg' },
  );

  const py = deps.env.PYTHON_BIN || 'python3';
  const w = await deps.exec(py, ['-c', 'import faster_whisper'], TIMEOUT * 2);
  items.push(
    w.code === 0
      ? { key: 'whisper', label: '本地转写', status: 'ok', detail: `faster-whisper 可用（${py}）` }
      : {
          key: 'whisper',
          label: '本地转写',
          status: 'fail',
          detail: w.code === 127 ? `找不到 Python：${py}` : w.code === 124 ? 'Python 没有响应（超时）' : '缺少 faster-whisper',
          fix: w.code === 127 ? '在 .env 里把 PYTHON_BIN 设为装了 faster-whisper 的 Python 路径' : `${py} -m pip install faster-whisper`,
        },
  );

  const remotionOk = await deps.exists(path.join(deps.cwd, 'remotion', 'node_modules', '@remotion', 'renderer'));
  items.push(
    remotionOk
      ? { key: 'remotion', label: '出片（Remotion）', status: 'ok', detail: '子工程依赖已安装' }
      : { key: 'remotion', label: '出片（Remotion）', status: 'fail', detail: 'remotion/ 子工程还没装依赖', fix: 'cd remotion && npm install' },
  );

  items.push(
    deps.collect.state === 'ok'
      ? { key: 'collect', label: '抖音回采', status: 'ok', detail: `上次成功：${new Date(deps.collect.lastSuccessAt!).toLocaleString('zh-CN')}` }
      : { key: 'collect', label: '抖音回采', status: 'warn', detail: deps.collect.hint },
  );
  items.push(
    deps.scan.state === 'ok'
      ? { key: 'scan', label: '对标巡检', status: 'ok', detail: `上次成功：${new Date(deps.scan.lastSuccessAt!).toLocaleString('zh-CN')}` }
      : { key: 'scan', label: '对标巡检', status: 'warn', detail: deps.scan.hint },
  );
  return items;
}
