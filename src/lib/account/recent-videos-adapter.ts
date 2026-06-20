import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface AccountRecentVideo {
  awemeId: string;
  desc: string;
  createTime: number;
  durationMs: number;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
}

function readAdapterEnv(): { adapterPath: string; contentDir: string; pythonBin: string } {
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

/**
 * 拉创作者中心的最近视频列表 (登录用户自己的账号).
 * Playwright 驱动, 30-60s 量级。 失败返回 null (登录态过期或抓接口失败).
 */
export async function fetchAccountRecentVideos(limit = 10): Promise<AccountRecentVideo[] | null> {
  const env = readAdapterEnv();
  const { stdout } = await execFileAsync(
    env.pythonBin,
    [path.join(env.adapterPath, 'review.py'), 'recent', String(limit)],
    {
      cwd: env.adapterPath,
      env: { ...process.env, PYTHONPATH: env.contentDir },
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const beginMarker = '__BEGIN_JSON__';
  const endMarker = '__END_JSON__';
  const beginIdx = stdout.indexOf(beginMarker);
  const endIdx = stdout.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1) return null;

  const jsonStr = stdout.slice(beginIdx + beginMarker.length, endIdx).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;

  return raw
    .map((v): AccountRecentVideo | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      const awemeId = o.aweme_id ? String(o.aweme_id) : '';
      if (!awemeId) return null;
      return {
        awemeId,
        desc: typeof o.desc === 'string' ? o.desc : '',
        createTime: typeof o.create_time === 'number' ? o.create_time : 0,
        durationMs: typeof o.duration_ms === 'number' ? o.duration_ms : 0,
        playCount: typeof o.play_count === 'number' ? o.play_count : 0,
        diggCount: typeof o.digg_count === 'number' ? o.digg_count : 0,
        commentCount: typeof o.comment_count === 'number' ? o.comment_count : 0,
        shareCount: typeof o.share_count === 'number' ? o.share_count : 0,
        collectCount: typeof o.collect_count === 'number' ? o.collect_count : 0,
      };
    })
    .filter((v): v is AccountRecentVideo => v !== null);
}
