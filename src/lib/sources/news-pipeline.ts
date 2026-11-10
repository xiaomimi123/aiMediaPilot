import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { fetchReadme, writeNewsScript, NEWS_TARGET_SEC } from './news';
import { synthesizeSpeech, ttsConfigFromEnv, DEFAULT_SPEAKER } from './tts';
import { createProject } from '@/lib/project/create';
import { toProjectView } from '@/lib/project/view';
import { projectDir } from '@/lib/files/storage';
import type { StructuredLLM } from '@/lib/script/write';

/**
 * 快讯档出稿核心( nightly 自动出稿与 POST /api/sources/news 共用 ):
 * 挑仓库 → 读 README → 写 30 秒稿 → 建作品 → AI 配音(可选)。
 * 挑选规则: 近 3 天 fresh 的 GitHub 条目按热度取最高, 没有就 null(调用方自己决定怎么报)。
 */

export interface NewsPick {
  id: string;
  outerId: string;
  title: string;
  heat: number;
}

/** 挑今天要出的仓库: fresh 的 GitHub 条目按热度最高(出过选题的已标 used 不会重复) */
export async function pickNewsRepo(db: Pick<PrismaClient, 'sourceItem'>, now: Date): Promise<NewsPick | null> {
  const rows = await db.sourceItem.findMany({
    where: { provider: 'github', status: 'fresh' },
    orderBy: { heat: 'desc' },
    take: 1,
  });
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, outerId: r.outerId, title: r.title, heat: r.heat };
}

export interface AutoNewsResult {
  project: ReturnType<typeof toProjectView>;
  title: string;
  voice: { file: string; speaker: string; bytes: number } | { error: string } | null;
}

/** 出一条快讯稿并建作品(voice=true 同时 AI 配音); 外部标记 used 由调用方在成功后处理 */
export async function produceNewsFor(
  db: PrismaClient,
  opts: { pick: NewsPick; llm: StructuredLLM; voice: boolean; speaker?: string; topic?: string | null },
): Promise<AutoNewsResult> {
  const readme = await fetchReadme(opts.pick.outerId);
  const out = await writeNewsScript({
    llm: opts.llm,
    repo: opts.pick.outerId,
    starCount: opts.pick.heat,
    readme: readme.text,
    topic: opts.topic ?? null,
  });
  const p = await createProject(db, out.title, { script: out.script, targetSec: NEWS_TARGET_SEC });

  let voice: AutoNewsResult['voice'] = null;
  if (opts.voice) {
    const cfg = ttsConfigFromEnv();
    if (!cfg) {
      voice = { error: '没配火山 TTS：.env 里要有 VOLC_TTS_APPID 和 VOLC_TTS_TOKEN' };
    } else {
      try {
        const fullText = out.script.segments.map((s) => s.text).join('');
        const { mp3 } = await synthesizeSpeech({ text: fullText, speaker: opts.speaker || DEFAULT_SPEAKER }, cfg);
        const dir = projectDir(p.id);
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, 'voiceover.v1.mp3');
        await fs.writeFile(file, mp3);
        await db.projectFile.create({ data: { projectId: p.id, kind: 'voiceover', path: file, version: 1, meta: { speaker: opts.speaker || DEFAULT_SPEAKER, provider: 'volc-tts' } } });
        voice = { file, speaker: opts.speaker || DEFAULT_SPEAKER, bytes: mp3.length };
      } catch (e) {
        voice = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
  return { project: toProjectView(p), title: out.title, voice };
}
