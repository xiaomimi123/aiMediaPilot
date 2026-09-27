import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** 项目文件(口播原片、转写)落盘位置。每个项目一个目录, 文件名带版本号, 重传不覆盖旧版。 */
export type FileKind = 'raw_video' | 'transcript';

const BASE: Record<FileKind, string> = { raw_video: 'raw', transcript: 'transcript' };

export function filesRoot(): string {
  return process.env.PROJECT_FILES_ROOT || path.join(process.cwd(), 'projects');
}

/** 项目 id 是 cuid(字母数字); 其他形状一律拒绝, 防止路径穿越。 */
export function projectDir(projectId: string): string {
  if (!/^[A-Za-z0-9]+$/.test(projectId)) throw new Error('非法项目编号');
  return path.join(filesRoot(), projectId);
}

export function versionedName(kind: FileKind, version: number, ext: string): string {
  return `${BASE[kind]}.v${version}${ext}`;
}

/** 转写用的抽音中间文件, 转写完成后删除 */
export function audioName(version: number): string {
  return `audio.v${version}.wav`;
}

export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v'] as const;

export function videoExt(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return (VIDEO_EXTS as readonly string[]).includes(ext) ? ext : null;
}

/** 流式写盘(口播原片动辄上百 MB, 不能整个读进内存)。失败时删掉半截文件再抛出。 */
export async function saveStreamToFile(stream: NodeJS.ReadableStream, dest: string): Promise<number> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await pipeline(stream, createWriteStream(dest));
  } catch (e) {
    await fs.unlink(dest).catch(() => {});
    throw e;
  }
  return (await fs.stat(dest)).size;
}
