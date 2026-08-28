/**
 * 时间线模型(二十三期)。
 *
 * 前一版的试做台是「一镜一镜地生成再看」—— 那不是编辑台。编辑台的定义是:
 * **能拖时间线, 停在哪一帧就调哪一帧**。所以核心是这三件事:
 *
 * 1. 播放头位置 ↔ 当前是哪个场景、在这个场景内的第几秒(预览要 seek 到那里)
 * 2. 像素 ↔ 毫秒的双向换算(拖动、缩放都靠它)
 * 3. 轨道块的排布
 *
 * 全做成纯函数是因为这几件事最容易出**差之毫厘的错**: 播放头显示 3.5 秒但预览
 * seek 到 3.2 秒, 肉眼看不出来, 但调出来的画面就是错的。这种错必须能被测试钉住。
 */

export interface TimelineScene {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
}

/** 时间线总长 = 最后一个场景的结束。空的时候是 0, 不是 NaN。 */
export function totalMs(scenes: TimelineScene[]): number {
  return scenes.reduce((m, s) => Math.max(m, s.endMs), 0);
}

export interface PlayheadHit {
  scene: TimelineScene;
  index: number;
  /** 播放头在这个场景内部的偏移(毫秒) —— 预览就 seek 到这里。 */
  offsetMs: number;
}

/**
 * 播放头落在哪个场景上。
 *
 * **左闭右开**(`start <= t < end`): 场景边界上必须只命中一个 —— 两个都命中会让
 * 预览在边界处来回跳。落在最后一个场景的结束点时归给最后一个场景, 否则拖到最右端
 * 会突然什么都不选中。
 */
export function sceneAt(scenes: TimelineScene[], ms: number): PlayheadHit | null {
  if (scenes.length === 0) return null;
  const sorted = [...scenes].sort((a, b) => a.startMs - b.startMs);

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const isLast = i === sorted.length - 1;
    const hit = isLast ? ms >= s.startMs && ms <= s.endMs : ms >= s.startMs && ms < s.endMs;
    if (hit) {
      return { scene: s, index: i, offsetMs: Math.max(0, ms - s.startMs) };
    }
  }
  // 落在所有场景之外(比如场景之间有空隙): 归给它前面最近的那个, 而不是返回 null
  // —— null 会让预览整块消失, 而空隙在时间线上肉眼几乎看不出来。
  const before = sorted.filter((s) => s.endMs <= ms);
  if (before.length > 0) {
    const s = before[before.length - 1];
    return { scene: s, index: sorted.indexOf(s), offsetMs: s.endMs - s.startMs };
  }
  return { scene: sorted[0], index: 0, offsetMs: 0 };
}

/** 毫秒 → 时间线上的像素。 */
export function msToPx(ms: number, total: number, widthPx: number): number {
  if (total <= 0) return 0;
  return (ms / total) * widthPx;
}

/**
 * 像素 → 毫秒。**结果夹在 [0, total]** —— 鼠标拖出容器外时不能算出负数或超长的
 * 时间, 那会让预览 seek 到不存在的位置然后静止。
 */
export function pxToMs(px: number, total: number, widthPx: number): number {
  if (widthPx <= 0 || total <= 0) return 0;
  return Math.round(Math.min(total, Math.max(0, (px / widthPx) * total)));
}

/** `1:06.3` 这样的时间码。编辑台上要能读到十分之一秒, 整秒不够用。 */
export function formatTimecode(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const s = Math.floor(clamped / 1000) % 60;
  const d = Math.floor(clamped / 100) % 10;
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

export interface TrackBlock {
  id: string;
  label: string;
  leftPct: number;
  widthPct: number;
}

/**
 * 把场景排成轨道上的块(百分比定位, 跟着容器一起缩放)。
 *
 * **极短的块给一个最小宽度**: 0.3 秒的场景在两分钟的时间线上不到 0.3%, 窄到点不
 * 中 —— 而点不中的块等于不存在。
 */
export function buildTrack(scenes: TimelineScene[], total: number, minWidthPct = 1.2): TrackBlock[] {
  if (total <= 0) return [];
  return scenes.map((s) => ({
    id: s.id,
    label: s.label,
    leftPct: (s.startMs / total) * 100,
    widthPct: Math.max(minWidthPct, ((s.endMs - s.startMs) / total) * 100),
  }));
}

/**
 * 从 SRT 文本解析出字幕块, 用来画时间线上的字幕轨。
 *
 * 只认 `HH:MM:SS,mmm --> HH:MM:SS,mmm` 这一种时间行 —— 试做台里的 SRT 是我们
 * 自己生成的, 不需要兼容各种野生格式; 解析不出来的行直接跳过, 不抛。
 */
export function parseSrtCues(srt: string): { startMs: number; endMs: number; text: string }[] {
  const out: { startMs: number; endMs: number; text: string }[] = [];
  const toMs = (t: string): number => {
    const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(t.trim());
    if (!m) return -1;
    return +m[1] * 3600000 + +m[2] * 60000 + +m[3] * 1000 + +m[4];
  };

  for (const block of (srt ?? '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const startMs = toMs(a ?? '');
    const endMs = toMs(b ?? '');
    const text = lines.slice(timeIdx + 1).join(' ').trim();
    if (startMs < 0 || endMs < 0 || !text) continue;
    out.push({ startMs, endMs, text });
  }
  return out;
}
