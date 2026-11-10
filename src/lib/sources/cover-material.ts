import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { designCoverCopy, renderCoverHtml } from './cover';
import { screenshotPage } from './demo-recorder';
import { projectDir } from '@/lib/files/storage';

/**
 * 快讯档封面一条龙: README+稿子 → 模型填封面文案 → 风格 D 模板渲染 HTML →
 * Playwright 截 1080×1440 PNG → 存项目目录登记 ProjectFile(kind='cover')。
 */

export async function buildCoverMaterial(
  db: PrismaClient,
  opts: { projectId: string; repo: string; starCount: number | null; readme: string; scriptText?: string; llm: Parameters<typeof designCoverCopy>[0]['llm'] },
): Promise<{ file: string; coverText: string[] }> {
  const copy = await designCoverCopy(opts);
  const html = renderCoverHtml(copy, { repo: opts.repo, starCount: opts.starCount });
  const dir = path.join(projectDir(opts.projectId), 'cover');
  await fs.mkdir(dir, { recursive: true });
  const htmlPath = path.join(dir, 'cover.html');
  const pngPath = path.join(dir, 'cover.v1.png');
  await fs.writeFile(htmlPath, html);
  await screenshotPage({ url: `file://${htmlPath}`, outFile: pngPath, width: 1080, height: 1440 });
  await db.projectFile.create({
    data: {
      projectId: opts.projectId,
      kind: 'cover',
      path: pngPath,
      version: 1,
      meta: { repo: opts.repo, coverText: copy.coverText, pick: copy.pick },
    },
  });
  return { file: pngPath, coverText: copy.coverText };
}
