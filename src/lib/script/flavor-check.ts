/**
 * AI 味检查: 用规则扫稿子, 找出口播里"一听就是 AI 写的"的句子。
 * 与照抄检查(copy-check)同一思路 —— 程序检查比提示词里"求模型别写"可靠;
 * 命中的句子只标出来给编导/用户改, 不自动动稿子。
 *
 * 灵感来源: blader/humanizer(Wikipedia "Signs of AI writing")、
 * Viral-Short-Form-Script-Skill 的 micro-diagnostics, 已本地化成中文口播场景。
 */

import { ROLE_LABEL, type Script } from '@/lib/script/model';

export interface FlavorHit {
  segmentId: string;
  segment: string;
  /** 规则 id */
  kind: string;
  /** 一句人话说明这条为什么扎眼 */
  label: string;
  /** 命中的原文片段 */
  text: string;
}

/** 单条句子级检查: 返回命中的片段(可能多个), 不命中返回空 */
type SentenceRule = { kind: string; label: string; test: (s: string) => string[] };

/** 词级规则: 句中出现的 AI 高频词 */
const WORD_RULES: SentenceRule[] = [
  {
    kind: 'hedge',
    label: '犹豫词：听起来不确定，改成干脆的说法或直接删掉',
    test: (s) => matchAll(s, /(?:说实话|其实呢|可能大概|应该差不多|我觉得可能|好像是有点)/g),
  },
  {
    kind: 'filler',
    label: '套话垫场：观众听到就知道没新东西，直接删或换成具体的话',
    test: (s) => matchAll(s, /(?:众所周知|不言而喻|毋庸置疑|综上所述|总而言之|换句话说|在这里呢|首先呢其次)/g),
  },
  {
    kind: 'grand',
    label: '空泛金句：像总结又没信息量，要么落到具体的事，要么删',
    test: (s) => matchAll(s, /(?:这不仅[^，。]{1,12}更是|改变(?:了)?(?:我们|整个)[的]?(?:生活|工作|方式|未来)|(?:开启|拥抱|赋能|助力)[^，。]{0,8}新时代|值得(?:每个人|我们)(?:深思|反思))/g),
  },
  {
    kind: 'ai-word',
    label: 'AI 高频词：书面腔，口播里换成大白话',
    test: (s) => matchAll(s, /(?:赋能|抓手|闭环|颗粒度|底层逻辑|思维模型|认知升级|降维打击)/g),
  },
];

/** 句级规则: 整句才算数 */
const SENTENCE_RULES: SentenceRule[] = [
  {
    kind: 'contrast',
    label: '「不是…而是…」句式：一听就是 AI，直接说结论',
    test: (s) => (/(?:不是|并非)[^。！？\n]{2,20}(?:而是|其实是|恰恰是)/.test(s) ? [s.trim()] : []),
  },
];

function matchAll(s: string, re: RegExp): string[] {
  return [...s.matchAll(re)].map((m) => m[0]);
}

const sentencesOf = (text: string) => text.match(/[^。！？!?\n]+[。！？!?\n]*/g)?.filter((x) => x.trim()) ?? [text];

/** 扫一篇稿子的全部 AI 味命中, 逐段标明 */
export function findFlavorInScript(script: Script): FlavorHit[] {
  return script.segments.flatMap((seg) => {
    const hits: FlavorHit[] = [];
    for (const sen of sentencesOf(seg.text)) {
      for (const rule of [...WORD_RULES, ...SENTENCE_RULES]) {
        for (const text of rule.test(sen)) hits.push({ segmentId: seg.id, segment: ROLE_LABEL[seg.role], kind: rule.kind, label: rule.label, text });
      }
    }
    return hits;
  });
}

/** 扫任意文本(草稿扩写结果等, 没有分段) */
export function findFlavorInText(text: string, segmentId = 's0', segment = '正文'): FlavorHit[] {
  return findFlavorInScript({ segments: [{ id: segmentId, role: 'close', text }] }).map((h) => ({ ...h, segmentId, segment }));
}

/** 编导对话/页面里的一句话摘要: 「钩子」有 2 处、… */
export function flavorSummary(hits: FlavorHit[]): string {
  if (!hits.length) return '';
  const bySeg = new Map<string, number>();
  for (const h of hits) bySeg.set(h.segment, (bySeg.get(h.segment) ?? 0) + 1);
  return `，${[...bySeg].map(([seg, n]) => `「${seg}」有 ${n} 处 AI 腔`).join('、')}`;
}
