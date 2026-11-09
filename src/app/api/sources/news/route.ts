import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { writeNewsScript, fetchReadme, NEWS_TARGET_SEC } from '@/lib/sources/news';
import { synthesizeSpeech, ttsConfigFromEnv, DEFAULT_SPEAKER } from '@/lib/sources/tts';
import { createProject } from '@/lib/project/create';
import { toProjectView } from '@/lib/project/view';
import { projectDir } from '@/lib/files/storage';

export const dynamic = 'force-dynamic';

type Body = { outerId?: string; action?: 'preview' | 'create'; topic?: string; title?: string; voice?: boolean; speaker?: string };

/** 从 SourceItem 里找 github 条目 */
async function findItem(outerId: string) {
  return prisma.sourceItem.findFirst({ where: { provider: 'github', outerId } });
}

/** POST: 生成快讯稿; action=create 建作品, voice=true 同时用火山 TTS 生成配音 mp3 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const outerId = String(b.outerId ?? '').trim();
  if (!outerId) return fail('缺仓库标识', 400);
  const item = await findItem(outerId);
  if (!item) return fail('这个仓库不在信息源里，等下次抓取或先去「选题」页看看列表', 404);
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);

  let readme: { text: string; url: string };
  try {
    readme = await fetchReadme(outerId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'README 没抓到', 502);
  }

  try {
    const out = await writeNewsScript({
      llm: m.llm,
      repo: outerId,
      starCount: item.heat,
      readme: readme.text,
      topic: b.topic?.trim() || null,
    });
    // 快讯不讲亲身经历, 原文不作说话样本
    if (b.action === 'create') {
      const p = await createProject(prisma, b.title?.trim() || out.title, { script: out.script, targetSec: NEWS_TARGET_SEC });

      // 要配音时: 全文合成 mp3 落到项目目录并登记为 voiceover 文件; 配音失败不影响建作品
      let voice: { file: string; speaker: string; bytes: number } | { error: string } | null = null;
      if (b.voice) {
        const cfg = ttsConfigFromEnv();
        if (!cfg) {
          voice = { error: '没配火山 TTS：.env 里要有 VOLC_TTS_APPID 和 VOLC_TTS_TOKEN' };
        } else {
          try {
            const fullText = out.script.segments.map((s) => s.text).join('');
            const { mp3 } = await synthesizeSpeech({ text: fullText, speaker: b.speaker || DEFAULT_SPEAKER }, cfg);
            const dir = projectDir(p.id);
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, 'voiceover.v1.mp3');
            await fs.writeFile(file, mp3);
            await prisma.projectFile.create({ data: { projectId: p.id, kind: 'voiceover', path: file, version: 1, meta: { speaker: b.speaker || DEFAULT_SPEAKER, provider: 'volc-tts' } } });
            voice = { file, speaker: b.speaker || DEFAULT_SPEAKER, bytes: mp3.length };
          } catch (e) {
            voice = { error: e instanceof Error ? e.message : String(e) };
          }
        }
      }
      return ok({ ...out, project: toProjectView(p), voice });
    }
    return ok({ ...out, readmeUrl: readme.url });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
