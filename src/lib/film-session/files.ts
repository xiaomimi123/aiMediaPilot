import fs from 'node:fs';
import path from 'node:path';

/** 出片过程里的截图 / 成片预览: 只放行该会话片子目录内的 png / mp4 */
export function resolveSessionFile(filmDirAbs: string, rel: string): string | null {
  if (!/\.(png|mp4)$/i.test(rel) || path.isAbsolute(rel)) return null;
  const root = path.resolve(filmDirAbs);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}
