import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

interface AdapterEnv {
  adapterPath: string;
  contentDir: string;
  pythonBin: string;
}

function readAdapterEnv(): AdapterEnv {
  const adapterPath = process.env.CHEAT_ADAPTER_PATH;
  const contentDir = process.env.CHEAT_CONTENT_PROJECT_DIR;
  if (!adapterPath || !contentDir) {
    throw new Error('CHEAT_ADAPTER_PATH 或 CHEAT_CONTENT_PROJECT_DIR 未配置');
  }
  return {
    adapterPath,
    contentDir,
    pythonBin: process.env.PYTHON_BIN || 'python3',
  };
}

export interface DouyinListItem {
  awemeId: string;
  postedAt: string;
  plays: string;
  desc: string;
}

const LINE_RE = /^\[\d+\]\s+(\S+)\s+(\S+\s\S+)\s+播放(\S+)\s+(.*)$/;

export function parseListOutput(stdout: string): DouyinListItem[] {
  return stdout
    .split('\n')
    .map((line) => line.match(LINE_RE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      awemeId: m[1],
      postedAt: m[2],
      plays: m[3],
      desc: m[4].trim(),
    }));
}

/** Maximum ms to wait for review.py list to respond. */
export const ADAPTER_TIMEOUT_MS = 60_000;

export async function runDouyinListAdapter(): Promise<DouyinListItem[]> {
  const env = readAdapterEnv();
  const { stdout } = await execFileAsync(
    env.pythonBin,
    [path.join(env.adapterPath, 'review.py'), 'list'],
    {
      cwd: env.adapterPath,
      env: { ...process.env, PYTHONPATH: env.contentDir },
      timeout: ADAPTER_TIMEOUT_MS,
    }
  );
  return parseListOutput(stdout);
}
