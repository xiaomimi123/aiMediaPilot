import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { SEGMENT_ROLES, ROLE_LABEL, type Script } from '@/lib/script/model';
import { CHARS_PER_SEC } from '@/lib/script/duration';
import { findFlavorInText, type FlavorHit } from '@/lib/script/flavor-check';

/**
 * 开源快讯档: 从 GitHub 仓库抓 README → 生成 30 秒口播稿。
 * 讲法按 roadmap 定的差异化: 不播报「XX 被开源了」, 讲「这是干嘛的、为什么值得看、
 * 普通人怎么上手」; 不编造, README 里没有的不说。
 * 稿子仍按 6 段结构(建作品/出片链都要求 6 段), 内容映射成快讯节拍。
 */

export const NEWS_TARGET_SEC = 30;

/** README 只取前 N 字(写稿素材, 太长挤掉别的信息) */
export const README_MAX_CHARS = 4000;

const LlmNewsSchema = z.object({
  title: z.string().min(1),
  segments: z.array(z.object({ text: z.string().min(1) })).length(SEGMENT_ROLES.length),
});
type LlmNews = z.infer<typeof LlmNewsSchema>;

export interface NewsResult {
  title: string;
  script: Script;
  /** 模型不确定、需要用户补证的地方 */
  questions: string[];
  /** 程序扫出的 AI 腔 */
  flavor: FlavorHit[];
}

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，写一条 30 秒的「开源项目快讯」口播稿。
讲法（与别的快讯号拉开差距）：
- 不是播报「XX 被开源了」，而是讲清三件事：这是干嘛的（用大白话，不用 README 里的行话）、为什么值得关注（star 数、是谁做的、解决了什么真问题）、普通人想试的话从哪上手。
- 只用【README 摘录】和【仓库信息】里的内容。不编造数字、功能、评价；README 没讲清的直接不写，拿不准的写进 questions 让博主确认（最多 3 条）。
- 开头钩子直接说「这个东西能干嘛」或反常识的点，不要说「今天给大家分享」。
- 写得像博主本人在说话，句子长短不齐，允许口语；不写「不是…而是…」句式、犹豫词、套话垫场、书面热词（赋能、底层逻辑、认知升级）。
- 6 段按快讯节拍：钩子 → 这是什么 → 为什么值得关注 → 怎么上手 → 注意点/局限 → 经验或悬念。某拍 README 里没有内容，就把相邻内容分过去，不硬编。
- 只输出 JSON：{"title": "视频标题", "segments": [{"text": "逐字稿"}, ...共 6 段]}。`;

const ROLE_HINT: Record<string, string> = {
  hook: '钩子',
  conceptA: '这是什么',
  conceptB: '为什么值得关注',
  fact: '怎么上手',
  bridge: '注意点/局限',
  close: '经验或悬念',
};

export function newsMessage(o: { repo: string; starCount: number | null; readme: string; topic?: string | null }): string {
  const parts: string[] = [];
  parts.push(`【仓库信息】${o.repo}${o.starCount !== null ? `（GitHub ${o.starCount.toLocaleString('en-US')} stars）` : ''}${o.topic ? `，用户的关注点：${o.topic}` : ''}`);
  parts.push(`【README 摘录】\n${o.readme}`);
  parts.push(`【目标时长】30 秒，按口语 ${CHARS_PER_SEC} 字/秒，全片约 ${NEWS_TARGET_SEC * CHARS_PER_SEC} 字`);
  parts.push(`【6 段节拍与参考字数】\n${SEGMENT_ROLES.map((r, i) => `${i + 1}. ${ROLE_HINT[r] ?? ROLE_LABEL[r]}：约 20～45 字`).join('\n')}`);
  parts.push('写这条快讯的口播稿。');
  return parts.join('\n\n');
}

export async function writeNewsScript(opts: { llm: StructuredLLM; repo: string; starCount: number | null; readme: string; topic?: string | null }): Promise<NewsResult> {
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [{ type: 'text', text: newsMessage(opts) }],
    responseSchema: LlmNewsSchema,
  });
  // 角色按位置对齐(与 write.ts 同一契约: 顺序才是契约)
  const script: Script = { segments: result.segments.map((s, i) => ({ id: `s${i + 1}`, role: SEGMENT_ROLES[i], text: s.text.trim() })) };
  if (script.segments.some((s) => !s.text)) throw new Error('模型交了空段，再点一次试试。');
  return { title: result.title.trim(), script, questions: [], flavor: findFlavorInText(script.segments.map((s) => s.text).join('\n')) };
}

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README_CN.md', 'README.zh-CN.md'];

/** 从 raw.githubusercontent 直取 README(不吃 API 限额); 依次试常见文件名; 网络偶发失败重试 2 次(真机见过 fetch failed) */
export async function fetchReadme(repo: string): Promise<{ text: string; url: string }> {
  const errors: string[] = [];
  const attempt = async (url: string): Promise<string | null> => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!r) {
        await new Promise((res) => setTimeout(res, 500 * (i + 1)));
        continue;
      }
      if (!r.ok) return null;
      const text = await r.text();
      if (text.trim()) return text;
      return null;
    }
    errors.push(`fetch failed: ${url.slice(30, 70)}`);
    return null;
  };
  for (const file of README_CANDIDATES) {
    for (const branch of ['main', 'master']) {
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
      const text = await attempt(url);
      if (text) return { text: stripMarkdown(text.slice(0, README_MAX_CHARS * 2)).slice(0, README_MAX_CHARS), url };
    }
  }
  throw new Error(`没抓到 README（${errors[0] ?? '仓库可能没有 README'}）`);
}

/** README 里的 markdown 标记对写稿是噪声, 去掉常见结构(链接/图片/代码块/表格线) */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<img[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
