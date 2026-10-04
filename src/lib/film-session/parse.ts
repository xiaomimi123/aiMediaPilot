export type Item =
  | { kind: 'you'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'step'; text: string; ok: boolean | null }
  | { kind: 'denied'; text: string }
  | { kind: 'still'; path: string };

export interface TurnResult {
  ended: boolean;
  isError: boolean;
  errorText: string | null;
  lastText: string | null;
  wroteShots: boolean;
  renderedFinal: boolean;
  registeredVersion: number | null;
  registeredSummary: string | null;
}

export interface ParsedLog {
  items: Item[];
  turns: number;
  filmDir: string | null;
  last: TurnResult;
}

type Use = { name: string; input: Record<string, unknown> };
const blank = (): TurnResult => ({ ended: false, isError: false, errorText: null, lastText: null, wroteShots: false, renderedFinal: false, registeredVersion: null, registeredSummary: null });
const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : '')).join('') : '');
const filmRel = (p: string) => /remotion\/films\/[^\s"'/]+/.exec(p)?.[0] ?? null;

function describe(u: Use, out: string, ok: boolean): string {
  const cmd = String(u.input.command ?? '');
  const file = String(u.input.file_path ?? '');
  if (u.name === 'Bash') {
    if (/mp -- project export/.test(cmd)) return '读稿子和素材';
    if (/mp -- project list/.test(cmd)) return '找项目';
    if (/mp -- film new/.test(cmd)) return `建片子目录 v${/-v(\d+)/.exec(out)?.[1] ?? '?'}`;
    if (/mp -- film check/.test(cmd)) return ok ? '检查：通过' : `检查：有 ${(out.match(/✗/g) ?? []).length || 1} 处问题`;
    if (/mp -- film render .*--stills/.test(cmd)) return '渲染关键帧';
    if (/mp -- film render/.test(cmd)) return '渲染成片（约 2 分钟）';
    if (/mp -- film register/.test(cmd)) return `登记 v${/v(\d+)/.exec(out)?.[1] ?? '?'}`;
    if (/^ffmpeg/.test(cmd)) return '抽帧看素材';
    if (/^ffprobe/.test(cmd)) return '看素材时长';
    return `命令：${cmd.slice(0, 60)}`;
  }
  if (u.name === 'Write' || u.name === 'Edit') {
    if (file.endsWith('shots.json')) return '排镜头表';
    if (/Film\.tsx$|copy\.ts$/.test(file)) return '写画面';
    return `写文件：${file.split('/').pop()}`;
  }
  if (u.name === 'Read') return /\.(png|jpe?g)$/i.test(file) ? '看图' : `读：${file.split('/').pop()}`;
  return `${u.name}`;
}

export function parseLog(lines: string[]): ParsedLog {
  const items: Item[] = [];
  const uses = new Map<string, Use>();
  let turns = 0;
  let filmDir: string | null = null;
  let last = blank();
  for (const line of lines) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // 半行(正在写)或非 JSON 输出
    }
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'mp_turn') {
      turns++;
      last = blank();
      items.push({ kind: 'you', text: String(ev.message ?? '') });
      continue;
    }
    if (ev.type === 'result') {
      last.ended = true;
      last.isError = !!ev.is_error;
      if (last.isError) last.errorText = String(ev.result ?? ev.subtype ?? '出错了');
      continue;
    }
    const content = (ev.message as { content?: unknown[] } | null | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content as (Record<string, unknown> | null)[]) {
      if (!c || typeof c !== 'object') continue;
      if (ev.type === 'assistant' && c.type === 'text' && String(c.text).trim()) {
        items.push({ kind: 'say', text: String(c.text).trim() });
        last.lastText = String(c.text).trim();
      }
      if (ev.type === 'assistant' && c.type === 'tool_use') uses.set(String(c.id), { name: String(c.name), input: (c.input ?? {}) as Record<string, unknown> });
      if (ev.type === 'user' && c.type === 'tool_result') {
        const u = uses.get(String(c.tool_use_id));
        if (!u) continue;
        const out = text(c.content);
        const ok = !c.is_error;
        if (!ok && /requested permissions|haven't granted|requires? approval/i.test(out)) {
          items.push({ kind: 'denied', text: `${u.name}：${String(u.input.command ?? u.input.file_path ?? '').slice(0, 80)}` });
          continue;
        }
        const file = String(u.input.file_path ?? '');
        if (u.name === 'Read' && /\/stills\/[^/]+\.(png|jpe?g)$/.test(file)) {
          items.push({ kind: 'still', path: file.slice(file.indexOf('stills/')) });
          continue;
        }
        items.push({ kind: 'step', text: describe(u, out, ok), ok });
        const cmd = String(u.input.command ?? '');
        if (ok && /mp -- film new/.test(cmd)) filmDir = filmRel(out) ?? filmDir;
        if (ok && (u.name === 'Write' || u.name === 'Edit') && file.endsWith('shots.json')) {
          last.wroteShots = true;
          filmDir = filmDir ?? filmRel(file);
        }
        if (ok && /mp -- film render/.test(cmd) && !/--stills/.test(cmd)) last.renderedFinal = true;
        if (ok && /mp -- film register/.test(cmd)) {
          last.registeredVersion = Number(/v(\d+)/.exec(out)?.[1] ?? NaN) || null;
          last.registeredSummary = /--summary "([^"]*)"/.exec(cmd)?.[1] ?? null;
        }
      }
    }
  }
  return { items, turns, filmDir, last };
}
