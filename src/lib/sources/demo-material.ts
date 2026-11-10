import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { designDemoPage, renderDemoHtml } from './demo-page';
import { recordDemoVideo } from './demo-recorder';
import { projectDir } from '@/lib/files/storage';

/**
 * 快讯档演示素材一条龙: README → 模型设计演示页内容 → 按风格渲染 HTML →
 * 无头浏览器录 8~12 秒横版动画 → 存项目目录并登记为 kind='material' 素材。
 * 优先录仓库官网(有 homepage 字段时); 没官网就录自动构建的介绍页(用户 2026-11-10 定的)。
 */

export const DEMO_VIDEO_SEC = 10;

async function repoHomepage(repo: string): Promise<string | null> {
  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { 'user-agent': 'MediaPilot/1.0', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { homepage?: string } | null;
  const h = j?.homepage?.trim();
  return h && /^https?:\/\//.test(h) ? h : null;
}

export interface DemoAsset {
  file: string;
  kind: 'homepage' | 'demo-page';
  width: number;
  height: number;
}

/**
 * 给项目生成演示视频素材。失败抛错(由调用方决定是否拦建作品)。
 * demo 目录: 项目目录下 demo/, HTML 和 mp4 都放那里, 素材登记指向 mp4。
 */
export async function buildDemoMaterial(
  db: PrismaClient,
  opts: { projectId: string; repo: string; starCount: number | null; readme: string; llm: Parameters<typeof designDemoPage>[0]['llm'] },
): Promise<DemoAsset> {
  const dir = path.join(projectDir(opts.projectId), 'demo');
  await fs.mkdir(dir, { recursive: true });

  // 有官网先试官网; 打不开(超时/非可渲染页)退回自动构建的介绍页
  const homepage = await repoHomepage(opts.repo);
  let url: string | null = null;
  let kind: DemoAsset['kind'] = 'demo-page';
  let htmlPath: string | null = null;
  if (homepage) {
    const ok = await fetch(homepage, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('text/html'))
      .catch(() => false);
    if (ok) {
      url = homepage;
      kind = 'homepage';
    }
  }
  if (!url) {
    const page = await designDemoPage({ llm: opts.llm, repo: opts.repo, starCount: opts.starCount, readme: opts.readme });
    const html = renderDemoHtml(page, opts.repo, opts.starCount);
    htmlPath = path.join(dir, 'demo-page.html');
    await fs.writeFile(htmlPath, html);
    url = `file://${htmlPath}`;
    kind = 'demo-page';
  }

  const outFile = path.join(dir, 'demo.v1.mp4');
  const v = await recordDemoVideo({ url, outFile, seconds: DEMO_VIDEO_SEC });

  await db.projectFile.create({
    data: {
      projectId: opts.projectId,
      kind: 'material',
      path: outFile,
      version: 1,
      meta: {
        note: kind === 'homepage' ? `官网演示录屏（${homepage}）` : 'README 自动构建演示页录屏',
        originalName: 'demo.v1.mp4',
        mediaType: 'video',
        width: v.width,
        height: v.height,
        durationSec: v.durationSec,
        demoKind: kind,
        ...(htmlPath ? { demoHtml: htmlPath } : {}),
      },
    },
  });
  return { file: outFile, kind, width: v.width, height: v.height };
}
