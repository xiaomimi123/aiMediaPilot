import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface PublicVideoFetchResult {
  awemeId: string;
  title: string;
  authorName?: string;
  createTime?: number; // unix seconds
  durationMs?: number;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  collectCount?: number;
  thumbnailUrl?: string | null;
}

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

/**
 * Returns normalized public-video data, or null when fetch yields no usable data
 * (e.g. cheat couldn't intercept the XHR — caller should fall back to manual entry).
 *
 * Throws on adapter env missing or process crash. Empty output → null (graceful).
 */
export async function fetchPublicVideo(awemeId: string): Promise<PublicVideoFetchResult | null> {
  const env = readAdapterEnv();
  const { stdout } = await execFileAsync(
    env.pythonBin,
    [path.join(env.adapterPath, 'review.py'), 'public', awemeId],
    {
      cwd: env.adapterPath,
      env: { ...process.env, PYTHONPATH: env.contentDir },
      timeout: 90_000,
    }
  );

  const beginMarker = '__BEGIN_JSON__';
  const endMarker = '__END_JSON__';
  const beginIdx = stdout.indexOf(beginMarker);
  const endIdx = stdout.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1) return null;

  const jsonStr = stdout.slice(beginIdx + beginMarker.length, endIdx).trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  // Empty / missing aweme_id → fetch yielded nothing usable
  if (!parsed.aweme_id || !parsed.title) return null;

  return {
    awemeId: String(parsed.aweme_id),
    title: String(parsed.title),
    authorName: typeof parsed.author_name === 'string' ? parsed.author_name : undefined,
    createTime: typeof parsed.create_time === 'number' ? parsed.create_time : undefined,
    durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : undefined,
    playCount: typeof parsed.play_count === 'number' ? parsed.play_count : undefined,
    diggCount: typeof parsed.digg_count === 'number' ? parsed.digg_count : undefined,
    commentCount: typeof parsed.comment_count === 'number' ? parsed.comment_count : undefined,
    shareCount: typeof parsed.share_count === 'number' ? parsed.share_count : undefined,
    collectCount: typeof parsed.collect_count === 'number' ? parsed.collect_count : undefined,
    thumbnailUrl: (parsed.thumbnail_url as string | null | undefined) ?? null,
  };
}
