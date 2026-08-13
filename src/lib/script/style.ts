import { prisma } from '@/lib/prisma';
import type { StyleContext } from '@/lib/llm/prompts/script-write-douyin';

/**
 * 风格层 —「定稿即样本」积累路线。
 *
 * StyleProfile 没有 User 反向关系 (T1 裁决, 简报字面优先), 一律
 * `prisma.styleProfile.findUnique({ where: { userId } })` 直查, 不走 `user.styleProfile`。
 */

const RECENT_SAMPLE_COUNT = 3;
const SAMPLES_MODE_THRESHOLD = 2;

/** 纯函数: 样本总数 <2 用风格说明兜底, ≥2 切换为最近样本 few-shot。 */
export function pickStyleMode(sampleCount: number): 'description' | 'samples' {
  return sampleCount >= SAMPLES_MODE_THRESHOLD ? 'samples' : 'description';
}

export async function getStyleContext(userId: string, platform: string): Promise<StyleContext> {
  const [profile, recentSamples, totalCount] = await Promise.all([
    prisma.styleProfile.findUnique({ where: { userId } }),
    prisma.styleSample.findMany({
      where: { userId, platform },
      orderBy: { createdAt: 'desc' },
      take: RECENT_SAMPLE_COUNT,
    }),
    prisma.styleSample.count({ where: { userId, platform } }),
  ]);

  return {
    mode: pickStyleMode(totalCount),
    description: profile?.description ?? '',
    samples: recentSamples.map((s) => s.content),
  };
}

/** 防御性解析 ScriptDraft.output(unknown Json) → script.sections[].text[]; 形状不对一律返回 null。 */
function extractSectionTexts(output: unknown): string[] | null {
  if (!output || typeof output !== 'object') return null;
  const script = (output as Record<string, unknown>).script;
  if (!script || typeof script !== 'object') return null;
  const sections = (script as Record<string, unknown>).sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;

  const texts: string[] = [];
  for (const section of sections) {
    if (!section || typeof section !== 'object' || typeof (section as { text?: unknown }).text !== 'string') {
      return null;
    }
    texts.push((section as { text: string }).text);
  }
  return texts;
}

export async function depositStyleSample(userId: string, scriptDraftId: string): Promise<boolean> {
  const draft = await prisma.scriptDraft.findFirst({ where: { id: scriptDraftId, userId } });
  if (!draft) return false;

  const sectionTexts = extractSectionTexts(draft.output);
  if (!sectionTexts) return false;

  const existing = await prisma.styleSample.findFirst({
    where: { userId, sourceScriptDraftId: scriptDraftId },
  });
  if (existing) return false;

  await prisma.styleSample.create({
    data: {
      userId,
      platform: draft.platform,
      content: sectionTexts.join('\n'),
      sourceScriptDraftId: scriptDraftId,
    },
  });
  return true;
}
