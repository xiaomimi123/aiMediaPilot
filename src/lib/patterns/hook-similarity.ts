/**
 * 检查两个钩子类型描述是否语义重叠.
 *
 * 当前实现 (启发式, 仅用于 UI 提示):
 * 1. 大小写归一 + 去掉前缀虚词 (用 / 以 / 含)
 * 2. 双向 substring 包含
 * 3. 2+ 字共同子串 (兼容 "数字开头" vs "开头用数字" 这种倒序表达)
 * 4. 同义词字典兜底 (数字/数据, 反差/反转, 悬念/疑问, etc.)
 *
 * 误报代价低 (绿勾误标比留空更鼓励用户), 漏报代价低 (用户可手动看).
 */

const SYNONYMS: Record<string, string[]> = {
  数字: ['数字', '数据', '数', '清单', '列表'],
  反差: ['反差', '反转', '对比', '颠覆', '出乎意料'],
  悬念: ['悬念', '疑问', '留白', '提问'],
  情绪: ['情绪', '共鸣', '痛点', '焦虑'],
  故事: ['故事', '经历', '案例', '亲历'],
  实操: ['实操', '教程', '步骤', '方法'],
  权威: ['权威', '专家', '研究', '引用'],
};

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/^(用|以|含|带|的|是)/, '');
}

function shared2charSubstring(a: string, b: string): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    const sub = a.slice(i, i + 2);
    if (b.includes(sub)) return true;
  }
  return false;
}

function inSynonymGroup(a: string, b: string): boolean {
  for (const group of Object.values(SYNONYMS)) {
    const aIn = group.some((w) => a.includes(w));
    const bIn = group.some((w) => b.includes(w));
    if (aIn && bIn) return true;
  }
  return false;
}

export function isHookTypeOverlap(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  if (shared2charSubstring(na, nb)) return true;
  if (inSynonymGroup(na, nb)) return true;
  return false;
}
