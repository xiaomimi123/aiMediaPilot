import { computeSceneRects, type SceneLayout } from './scene-layout';

/**
 * 逐场景版面的 ffmpeg 滤镜(二十三期)。
 *
 * 在这之前只有两种合成: 顺序挖空(B-roll 整段替换人)和角落画中画。分屏、圆窗这些
 * 在编辑台里能选、能预览, 但**出片时根本没实现** —— 编辑台画的框和成片对不上,
 * 那正是这个项目一再要避免的「界面在撒谎」。
 *
 * 五种版面各自的滤镜形态:
 *
 * | 版面 | 画面 |
 * |---|---|
 * | `person-full` | 只有源视频这一段, 原样直通 |
 * | `content-full` | 只有 B-roll, 等比缩放加黑边(老的挖空行为) |
 * | `content-left` / `content-right` | 黑底 + 两块各自 cover 裁切后叠上去 |
 * | `person-circle` | B-roll 铺满 + 圆形裁切的人像叠在右下 |
 *
 * **分屏和圆窗都用 cover(increase + crop)而不是 contain(decrease + pad)**:
 * 一块窄长的分屏区里用 contain 会出现上下两条粗黑边, 人像缩成中间一小条 ——
 * 那不是分屏, 是加了边框的小图。cover 会裁掉画面边缘, 但保证那一块是满的。
 */

export interface SceneSegment {
  startMs: number;
  endMs: number;
  /** B-roll 片段路径。`person-full` 时可以没有。 */
  clipPath?: string;
  layout: SceneLayout;
}

/** 等比铺满目标框并裁掉溢出的部分。 */
function coverTo(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

/** 等比放进目标框, 空余补黑。整幅画面用它 —— 裁掉观众要看的内容更糟。 */
function containTo(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

/**
 * 圆形遮罩。
 *
 * 用 `geq` 逐像素算 alpha 而不是外挂一张 PNG 蒙版: 圆窗直径随模板配置变, 外挂
 * 蒙版就得为每个尺寸生成一张图并管理它的生命周期, 而 geq 只是一个表达式。
 * 代价是每帧都要算, 但圆窗本身只占画面几十分之一, 实测不是瓶颈。
 */
function circleMask(d: number): string {
  const r = Math.round(d / 2);
  return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt((X-${r})*(X-${r})+(Y-${r})*(Y-${r}),${r}*${r}),0,255)'`;
}

export interface SceneComposeOpts {
  sourceVideoPath: string;
  segments: SceneSegment[];
  outputPath: string;
  frame: { width: number; height: number };
  /** 源视频总时长(毫秒), 用来决定要不要接尾段。 */
  sourceDurationMs?: number;
}

/**
 * 构造 ffmpeg 参数。
 *
 * 音轨**整段直取源文件的第一条**, 不随画面切分 —— 画面切到 B-roll 期间人声必须
 * 连续。取 `0:a:0` 而不是 `0:a`: iPhone 录的 .mov 常带第二条空间音频轨,
 * `-map 0:a` 会把它也映射进来, 而本机 ffmpeg 没有 apple_apac 解码器, 直接报错退出。
 */
export function buildSceneComposeArgs(opts: SceneComposeOpts): string[] {
  const { width: W, height: H } = opts.frame;
  const sorted = [...opts.segments].sort((a, b) => a.startMs - b.startMs);

  // 只有需要 B-roll 的段才占一个输入位 —— person-full 不吃输入, 白占会让索引错位
  const inputs: string[] = ['-y', '-i', opts.sourceVideoPath];
  const clipIndex = new Map<number, number>();
  sorted.forEach((seg, i) => {
    if (seg.layout !== 'person-full' && seg.clipPath) {
      inputs.push('-stream_loop', '-1', '-i', seg.clipPath);
      clipIndex.set(i, clipIndex.size + 1);
    }
  });

  if (sorted.length === 0) {
    return [...inputs, '-map', '0:v', '-map', '0:a:0', '-c:v', 'libx264', '-c:a', 'aac', opts.outputPath];
  }

  const parts: string[] = [];
  const concat: string[] = [];
  let cursorMs = 0;
  let n = 0;

  const pushGap = (fromMs: number, toMs: number) => {
    if (toMs <= fromMs) return;
    const label = `g${n++}`;
    parts.push(`[0:v]trim=start=${fromMs / 1000}:end=${toMs / 1000},setpts=PTS-STARTPTS[${label}]`);
    concat.push(`[${label}]`);
  };

  sorted.forEach((seg, i) => {
    pushGap(cursorMs, seg.startMs);

    const durSec = (seg.endMs - seg.startMs) / 1000;
    const src = `[0:v]trim=start=${seg.startMs / 1000}:end=${seg.endMs / 1000},setpts=PTS-STARTPTS`;
    const clip = clipIndex.has(i)
      ? `[${clipIndex.get(i)}:v]trim=start=0:end=${durSec},setpts=PTS-STARTPTS`
      : null;
    const out = `s${n++}`;
    const rects = computeSceneRects(opts.frame, seg.layout);

    if (seg.layout === 'person-full' || !clip) {
      // 只有人。原样直通, 不缩放 —— 保持原画质。
      parts.push(`${src}[${out}]`);
    } else if (seg.layout === 'content-full') {
      parts.push(`${clip},${containTo(W, H)},setsar=1[${out}]`);
    } else if (seg.layout === 'person-circle') {
      const p = rects.person!;
      parts.push(`${clip},${containTo(W, H)},setsar=1[bg${out}]`);
      parts.push(`${src},${coverTo(p.width, p.height)},${circleMask(p.width)}[pp${out}]`);
      parts.push(`[bg${out}][pp${out}]overlay=${p.x}:${p.y}:format=auto[${out}]`);
    } else {
      // 分屏。先铺一层黑底, 再把两块叠上去 —— 两块之间有留白, 没有底会露出前一帧
      const c = rects.content!;
      const p = rects.person!;
      parts.push(`color=c=black:s=${W}x${H}:d=${durSec}[bd${out}]`);
      parts.push(`${clip},${coverTo(c.width, c.height)},setsar=1[cc${out}]`);
      parts.push(`${src},${coverTo(p.width, p.height)},setsar=1[pp${out}]`);
      parts.push(`[bd${out}][cc${out}]overlay=${c.x}:${c.y}[b1${out}]`);
      parts.push(`[b1${out}][pp${out}]overlay=${p.x}:${p.y}[${out}]`);
    }

    concat.push(`[${out}]`);
    cursorMs = seg.endMs;
  });

  // 尾段。给了总时长且最后一段已经顶到末尾时跳过 —— 零长片段会让 concat 报错。
  const hasTail =
    opts.sourceDurationMs === undefined || cursorMs < opts.sourceDurationMs - 1;
  if (hasTail) {
    const label = `t${n++}`;
    parts.push(`[0:v]trim=start=${cursorMs / 1000},setpts=PTS-STARTPTS[${label}]`);
    concat.push(`[${label}]`);
  }

  parts.push(`${concat.join('')}concat=n=${concat.length}:v=1:a=0[vout]`);

  return [
    ...inputs,
    '-filter_complex',
    parts.join(';'),
    '-map', '[vout]',
    '-map', '0:a:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    opts.outputPath,
  ];
}
