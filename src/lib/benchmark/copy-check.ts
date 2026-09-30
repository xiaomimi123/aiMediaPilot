import { ROLE_LABEL, type Script } from '@/lib/script/model';

/** 与对标逐字稿连续 12 字以上相同 = 照抄。去掉标点和空白再比, 避免加个逗号就绕过。 */
export const COPY_RUN = 12;

const norm = (s: string) => Array.from(s.replace(/[\s\p{P}\p{S}]/gu, ''));

export function findCopied(text: string, reference: string, run = COPY_RUN): string[] {
  const t = norm(text);
  const ref = norm(reference).join('');
  if (!ref || t.length < run) return [];
  const hit = new Array<boolean>(t.length).fill(false);
  for (let i = 0; i + run <= t.length; i++) {
    if (ref.includes(t.slice(i, i + run).join(''))) for (let j = i; j < i + run; j++) hit[j] = true;
  }
  const out: string[] = [];
  let cur = '';
  hit.forEach((h, i) => {
    if (h) cur += t[i];
    else if (cur) {
      out.push(cur);
      cur = '';
    }
  });
  if (cur) out.push(cur);
  return out;
}

export interface CopiedRun {
  segmentId: string;
  segment: string;
  text: string;
}

/** 逐段查照抄, 标明段落 —— 只给句子不给段落时, 编导会去改错段(2026-09-28 真机) */
export function findCopiedInScript(script: Script, reference: string): CopiedRun[] {
  return script.segments.flatMap((s) => findCopied(s.text, reference).map((text) => ({ segmentId: s.id, segment: ROLE_LABEL[s.role], text })));
}

export function copiedSummary(copied: CopiedRun[]): string {
  if (!copied.length) return '';
  const bySeg = new Map<string, number>();
  for (const c of copied) bySeg.set(c.segment, (bySeg.get(c.segment) ?? 0) + 1);
  return `，${[...bySeg].map(([seg, n]) => `「${seg}」有 ${n} 处`).join('、')}照抄对标原句`;
}
