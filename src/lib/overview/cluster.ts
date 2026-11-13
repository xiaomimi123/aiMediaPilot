import type { FeedRow } from './feed';

/**
 * 把同一件事收成一组，首页只留少数几条。
 * 合并只看已有字段：同一个 GitHub 仓库、同一条外链、同一个产品名（带连字符或版本号），
 * 或者标题本身很像。不调用模型，也不编理由。
 *
 * 默认列表还会收起两类：热度分低于 75，以及 X 上没碰到赛道词或正文太短的。
 * 「显示全部」才把它们展开。阈值改这里。
 */

export const HOME_PICKS = 10;
export const SOURCE_CAP = 4;
export const SCORE_FLOOR = 75;
export const THIN_X_CHARS = 12;
const KEY_CAP = 6;
const CLUSTER_CAP = 8;

export interface TopicCluster {
  id: string;
  lead: FeedRow;
  related: FeedRow[];
}

const LATIN_STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'you', 'your', 'are', 'was', 'were', 'have', 'has', 'had',
  'but', 'not', 'just', 'about', 'what', 'when', 'how', 'who', 'its', 'into', 'over', 'after', 'before', 'they',
  'them', 'their', 'will', 'can', 'all', 'out', 'now', 'new', 'one', 'our', 'open', 'source', 'built', 'using',
  'like', 'been', 'more', 'some', 'than', 'then', 'very', 'really', 'there', 'here', 'make', 'made', 'app', 'apps',
]);

export function whyLine(row: FeedRow): string {
  const summary = distinctSummary(row.title, row.why);
  const track = trackLine(row);
  const heat = row.heatLabel;
  if (summary) return [heat, summary].filter(Boolean).join(' · ');
  return [heat, track].filter(Boolean).join(' · ') || row.sourceLabel;
}

export function isThin(row: FeedRow): boolean {
  if (row.provider !== 'x') return false;
  const fit = row.score.parts.find((part) => part.key === 'fit')?.value ?? 0;
  if (!fit) return true;
  const text = `${row.title}\n${row.why ?? ''}`.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, '');
  return text.length < THIN_X_CHARS;
}

export function hiddenByDefault(row: FeedRow): boolean {
  return row.score.total < SCORE_FLOOR || isThin(row);
}

function trackLine(row: FeedRow): string | null {
  const fit = row.score.parts.find((part) => part.key === 'fit');
  if (!fit?.value) return null;
  const hit = /命中([^。]+)/.exec(fit.detail);
  return hit ? `碰到${hit[1]}` : null;
}

function distinctSummary(title: string, why: string | null): string | null {
  if (!why) return null;
  const text = why
    .replace(/\n话题\s+\S+/g, '')
    .replace(/\nr\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.startsWith('话题 ')) return null;
  const compact = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const a = compact(title).slice(0, 24);
  const b = compact(text).slice(0, 24);
  if (a && b && (a.startsWith(b) || b.startsWith(a))) return null;
  const parts = text.split(/(?<=[。！？.!?])\s/).map((part) => part.trim()).filter(Boolean);
  const sentence = parts.find((part) => !/^(hey|hi|hello|大家好|各位)[\s,，!！]/i.test(part) && part.replace(/[^\p{L}\p{N}]/gu, '').length >= 8);
  if (!sentence) return null;
  const cleaned = sentence.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return cleaned.length > 56 ? `${cleaned.slice(0, 56)}…` : cleaned;
}

function latinTokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[a-z][a-z0-9+#.]{3,}/g)) {
    const word = match[0].replace(/[.+#]+$/, '');
    if (word.length >= 4 && !LATIN_STOP.has(word)) out.push(word);
  }
  return out;
}

function cjkGrams(text: string): string[] {
  const chars = text.replace(/[^\u4e00-\u9fff]/g, '');
  const grams: string[] = [];
  for (let i = 0; i < chars.length - 2; i++) {
    const gram = chars.slice(i, i + 3);
    if (/[的了是在我有和就不人也到说要这那你他她它吗呢吧着过与或及很都还]/.test(gram)) continue;
    grams.push(gram);
  }
  return grams;
}

export function titlesSimilar(a: string, b: string): boolean {
  const left = new Set(latinTokens(a));
  const right = new Set(latinTokens(b));
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  const union = left.size + right.size - shared;
  if (shared >= 2 && union > 0 && shared / union >= 0.5) return true;
  const grams = new Set(cjkGrams(b));
  const seen = new Set<string>();
  let hits = 0;
  for (const gram of cjkGrams(a)) {
    if (seen.has(gram)) continue;
    seen.add(gram);
    if (grams.has(gram)) hits++;
  }
  return hits >= 2;
}

function repoKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi)) {
    if (['topics', 'pull', 'issues', 'blob', 'tree', 'releases'].includes(match[2].toLowerCase())) continue;
    keys.push(`gh:${match[1].toLowerCase()}/${match[2].toLowerCase()}`);
  }
  for (const match of text.matchAll(/(?:^|[\s(])([A-Za-z0-9_.-]{2,})\/([A-Za-z0-9_.-]{2,})(?=$|[\s)]|,|，)/g)) {
    keys.push(`gh:${match[1].toLowerCase()}/${match[2].toLowerCase()}`);
  }
  return keys;
}

function linkKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)）]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),，。]+$/, ''));
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 't.co' || host === 'x.com' || host === 'twitter.com' || host === 'reddit.com' || host.endsWith('.reddit.com')) continue;
      let path = url.pathname.replace(/\/+$/, '');
      if (host === 'github.com') {
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) path = `/${parts[0]}/${parts[1]}`;
      }
      if (path && path !== '/') keys.push(`url:${host}${path}`.toLowerCase());
    } catch {
      /* 残缺链接不当钥匙 */
    }
  }
  return keys;
}

const GENERIC_PART = new Set([
  'open', 'source', 'self', 'full', 'real', 'time', 'stack', 'cross', 'multi', 'well', 'third', 'party', 'command',
  'line', 'based', 'ready', 'free', 'world', 'level', 'side', 'ended', 'hosted', 'improving', 'learning', 'making',
  'using', 'powered', 'driven', 'first', 'best', 'more', 'like', 'only', 'your', 'with', 'from', 'this', 'that',
]);

function nameKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)+\b/g)) {
    const name = match[0].toLowerCase();
    const parts = name.split(/[-.]/).filter(Boolean);
    if (name.length < 6 || parts.length < 2) continue;
    if (!parts.some((part) => part.length >= 5 && !GENERIC_PART.has(part))) continue;
    if (parts.some((part) => GENERIC_PART.has(part)) && !/\d/.test(name)) continue;
    keys.push(`name:${name}`);
  }
  const plainVersion = new Set(['apache', 'http', 'https', 'utf', 'pdf', 'html', 'css', 'mit', 'bsd', 'gpl', 'iso', 'rfc']);
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9.+-]{2,})\s+(\d+(?:\.\d+){1,2})\b/g)) {
    if (plainVersion.has(match[1].toLowerCase())) continue;
    keys.push(`name:${match[1].toLowerCase()} ${match[2]}`);
  }
  return keys;
}

function keyRank(key: string): number {
  if (key.startsWith('gh:')) return 0;
  if (key.startsWith('url:')) return 1;
  if (/\d/.test(key)) return 2;
  return 3;
}

function rowKeys(row: FeedRow): string[] {
  const blob = `${row.title}\n${row.why ?? ''}\n${row.url ?? ''}`;
  return [...new Set([...repoKeys(blob), ...linkKeys(blob), ...nameKeys(`${row.title}\n${row.why ?? ''}`)])];
}

function byScore(a: FeedRow, b: FeedRow): number {
  return b.score.total - a.score.total || (b.heat ?? -1) - (a.heat ?? -1);
}

/** 分数从高到低的一组。领头是分最高的那条，其余算相关。不同钥匙不会串成一大团。 */
export function clusterRows(rows: FeedRow[]): TopicCluster[] {
  const buckets = new Map<string, FeedRow[]>();
  for (const row of rows) {
    for (const key of rowKeys(row)) {
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }
  }
  const candidates = [...buckets.entries()]
    .filter(([, list]) => list.length >= 2 && list.length <= KEY_CAP)
    .sort((a, b) => keyRank(a[0]) - keyRank(b[0]) || a[1].length - b[1].length);

  const groupOf = new Map<string, FeedRow[]>();
  for (const [, list] of candidates) {
    const free = list.filter((row) => !groupOf.has(row.key));
    if (free.length < 2) continue;
    const group = free.slice(0, CLUSTER_CAP);
    for (const row of group) groupOf.set(row.key, group);
  }

  const leadOf = new Map<string, FeedRow[]>();
  const alone: FeedRow[] = [];
  const seen = new Set<FeedRow[]>();
  for (const row of rows) {
    const group = groupOf.get(row.key) ?? [row];
    if (seen.has(group)) continue;
    seen.add(group);
    const sorted = [...group].sort(byScore);
    leadOf.set(sorted[0].key, sorted);
    if (sorted.length === 1) alone.push(sorted[0]);
  }

  const pending = [...alone].sort((a, b) => a.score.total - b.score.total);
  for (const row of pending) {
    const own = leadOf.get(row.key);
    if (!own || own.length !== 1) continue;
    let best: FeedRow[] | null = null;
    for (const list of leadOf.values()) {
      if (list[0].key === row.key || list.length >= CLUSTER_CAP) continue;
      if (!titlesSimilar(row.title, list[0].title)) continue;
      if (!best || byScore(list[0], best[0]) < 0) best = list;
    }
    if (!best) continue;
    best.push(row);
    leadOf.delete(row.key);
  }

  return [...leadOf.values()]
    .map((list) => {
      const [lead, ...related] = [...list].sort(byScore);
      return { id: lead.key, lead, related };
    })
    .sort((a, b) => byScore(a.lead, b.lead));
}

/** 首页大约 10 条：先保证每个来源至少一条，再按分数补，同一来源最多 SOURCE_CAP 条。 */
export function pickHome(clusters: TopicCluster[], limit = HOME_PICKS): TopicCluster[] {
  const sorted = [...clusters].sort((a, b) => byScore(a.lead, b.lead));
  const reserved = new Map<string, TopicCluster>();
  for (const cluster of sorted) {
    if (!reserved.has(cluster.lead.provider)) reserved.set(cluster.lead.provider, cluster);
  }
  const picked: TopicCluster[] = [];
  const seen = new Set<string>();
  const count = new Map<string, number>();
  const take = (cluster: TopicCluster) => {
    if (seen.has(cluster.id) || picked.length >= limit) return;
    picked.push(cluster);
    seen.add(cluster.id);
    count.set(cluster.lead.provider, (count.get(cluster.lead.provider) ?? 0) + 1);
  };
  for (const cluster of reserved.values()) take(cluster);
  for (const cluster of sorted) {
    if ((count.get(cluster.lead.provider) ?? 0) >= SOURCE_CAP) continue;
    take(cluster);
  }
  for (const cluster of sorted) take(cluster);
  return picked.sort((a, b) => byScore(a.lead, b.lead));
}

const SOURCE_ORDER = ['github', 'hackernews', 'x', 'reddit', 'benchmark', 'sequel', 'idea'];

/** 全部来源时按来源排，单一来源时按时间排。组内仍按分数。 */
export function arrangeClusters(clusters: TopicCluster[], groupBy: 'source' | 'date'): TopicCluster[] {
  const dateRank = (label: string) => (label === '今天' ? 0 : label === '昨天' ? 1 : label.endsWith('天前') ? 2 : 3);
  return [...clusters].sort((a, b) => {
    if (groupBy === 'source') {
      const pa = SOURCE_ORDER.indexOf(a.lead.provider);
      const pb = SOURCE_ORDER.indexOf(b.lead.provider);
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || b.lead.score.total - a.lead.score.total;
    }
    return dateRank(a.lead.seenLabel) - dateRank(b.lead.seenLabel) || b.lead.score.total - a.lead.score.total;
  });
}

export function clusterSources(cluster: TopicCluster): { provider: string; label: string }[] {
  const seen = new Set<string>();
  const out: { provider: string; label: string }[] = [];
  for (const row of [cluster.lead, ...cluster.related]) {
    if (seen.has(row.provider)) continue;
    seen.add(row.provider);
    out.push({ provider: row.provider, label: row.sourceLabel });
  }
  return out;
}
