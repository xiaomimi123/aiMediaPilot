import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';

export interface ProbeResult {
  durationSec: number;
  formatName: string;
}

export function buildProbeArgs(videoPath: string): string[] {
  return ['-v', 'error', '-show_format', '-of', 'json', videoPath];
}

export function parseProbeOutput(stdout: string): ProbeResult {
  const json = JSON.parse(stdout);
  const fmt = json?.format;
  if (!fmt) throw new Error('ffprobe output missing .format key');
  const duration = parseFloat(fmt.duration ?? '');
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe returned invalid duration: ${fmt.duration}`);
  }
  return {
    durationSec: duration,
    formatName: fmt.format_name ?? '',
  };
}

export async function probeVideo(videoPath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, buildProbeArgs(videoPath), { timeout: 30_000 });
  return parseProbeOutput(stdout);
}

export interface ExtractFramesOpts {
  videoPath: string;
  framesDir: string;
  intervalSec: number;
}

export function buildExtractFramesArgs(opts: ExtractFramesOpts): string[] {
  return [
    '-y',
    '-i', opts.videoPath,
    '-vf', `fps=1/${opts.intervalSec}`,
    '-q:v', '3',
    path.join(opts.framesDir, 'frame_%04d.jpg'),
  ];
}

export async function extractFrames(opts: ExtractFramesOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildExtractFramesArgs(opts), { timeout: 600_000 });
}

export interface ExtractAudioOpts {
  videoPath: string;
  audioPath: string;
}

export function buildExtractAudioArgs(opts: ExtractAudioOpts): string[] {
  return [
    '-y',
    '-i', opts.videoPath,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-f', 'wav',
    opts.audioPath,
  ];
}

export async function extractAudio(opts: ExtractAudioOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildExtractAudioArgs(opts), { timeout: 600_000 });
}

export interface ExtractSingleFrameOpts {
  videoPath: string;
  timestampSec: number;
  outputPath: string;
}

export function buildExtractSingleFrameArgs(opts: ExtractSingleFrameOpts): string[] {
  return [
    '-y',
    '-ss', String(opts.timestampSec),
    '-i', opts.videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    opts.outputPath,
  ];
}

export async function extractSingleFrame(opts: ExtractSingleFrameOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildExtractSingleFrameArgs(opts), { timeout: 30_000 });
}

export interface EncodeFramesOpts {
  framesDir: string;
  fps: number;
  outputPath: string;
}

export function buildEncodeFramesArgs(opts: EncodeFramesOpts): string[] {
  return [
    '-y',
    '-framerate', String(opts.fps),
    '-i', path.join(opts.framesDir, 'frame_%04d.png'),
    '-pix_fmt', 'yuv420p',
    opts.outputPath,
  ];
}

export async function encodeFramesToClip(opts: EncodeFramesOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildEncodeFramesArgs(opts), { timeout: 600_000 });
}

export interface ConcatClipsOpts {
  clipPaths: string[];
  outputPath: string;
  concatListPath: string;
}

export function buildConcatArgs(opts: ConcatClipsOpts): string[] {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', opts.concatListPath,
    '-c', 'copy',
    opts.outputPath,
  ];
}

export async function concatClips(opts: ConcatClipsOpts): Promise<void> {
  const listContent = opts.clipPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  await fs.writeFile(opts.concatListPath, listContent, 'utf-8');
  await execFileAsync(FFMPEG_BIN, buildConcatArgs(opts), { timeout: 600_000 });
}

export interface CutawaySegment {
  startMs: number;
  endMs: number;
  clipPath: string; // 该区间要替换成的 B-roll 画面文件路径(已渲染好的无声视频)
}

export interface CompositeCutawayOpts {
  sourceVideoPath: string; // 原始出镜视频(含音轨)
  segments: CutawaySegment[]; // 顺序任意，内部会按 startMs 防御性排序，互不重叠
  outputPath: string;
}

/**
 * 挖空替换合成：把 sourceVideoPath 按 segments 时间点切成"原始片段/替换片段"交替序列，
 * 用 concat filter 拼成一条连续画面流；音频轨道始终整段直接用源文件的原始音轨，不做任何切分——
 * 画面切到 B-roll 期间，人声依然连续播放。
 *
 * B-roll 时长对齐策略：每个 B-roll 输入都以 `-stream_loop -1` 打开(无限循环该输入文件)，
 * 再在 filter 里用 `trim=0:<segment 目标时长>` 精确截到 segment 需要的长度——
 * 这样无论 B-roll 素材本身比 segment 短(会被循环补齐)还是比 segment 长(会被直接截断)都能正确处理，
 * 不需要提前判断素材实际时长。
 *
 * 已知局限：如果某个 segment 的 endMs 恰好等于源视频总时长，尾部会生成一段 `trim=start=<end>`
 * (无 end 参数、理论上长度为 0) 的片段传给 concat，可能导致 ffmpeg 报错。当前实现未特殊处理这个
 * 边界(需要提前 ffprobe 源时长才能识别)，如果实际使用中遇到该场景需要额外处理。
 */
export function buildCompositeCutawayArgs(opts: CompositeCutawayOpts): string[] {
  const indexed = opts.segments.map((seg, i) => ({ ...seg, inputIndex: i + 1 }));
  const sorted = [...indexed].sort((a, b) => a.startMs - b.startMs);

  const inputArgs: string[] = ['-y', '-i', opts.sourceVideoPath];
  for (const seg of indexed) {
    inputArgs.push('-stream_loop', '-1', '-i', seg.clipPath);
  }

  if (sorted.length === 0) {
    // 没有 segment：原样直通源视频的视频流与音频流
    return [...inputArgs, '-map', '0:v', '-map', '0:a', '-c:v', 'libx264', '-c:a', 'aac', opts.outputPath];
  }

  const filterParts: string[] = [];
  const concatLabels: string[] = [];
  let cursorMs = 0;
  let pieceIdx = 0;

  for (const seg of sorted) {
    if (seg.startMs > cursorMs) {
      const label = `s${pieceIdx}`;
      filterParts.push(
        `[0:v]trim=start=${cursorMs / 1000}:end=${seg.startMs / 1000},setpts=PTS-STARTPTS[${label}]`,
      );
      concatLabels.push(`[${label}]`);
      pieceIdx++;
    }
    const durSec = (seg.endMs - seg.startMs) / 1000;
    const label = `b${pieceIdx}`;
    filterParts.push(`[${seg.inputIndex}:v]trim=start=0:end=${durSec},setpts=PTS-STARTPTS[${label}]`);
    concatLabels.push(`[${label}]`);
    pieceIdx++;
    cursorMs = seg.endMs;
  }

  // 尾段：从最后一个 segment 结束到源视频结尾(不带 end 参数，trim 自动取到输入末尾)
  const tailLabel = `s${pieceIdx}`;
  filterParts.push(`[0:v]trim=start=${cursorMs / 1000},setpts=PTS-STARTPTS[${tailLabel}]`);
  concatLabels.push(`[${tailLabel}]`);

  const concatFilter = `${concatLabels.join('')}concat=n=${concatLabels.length}:v=1:a=0[outv]`;
  filterParts.push(concatFilter);

  return [
    ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    opts.outputPath,
  ];
}

export async function compositeCutawayVideo(opts: CompositeCutawayOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildCompositeCutawayArgs(opts), { timeout: 600_000 });
}

export interface BuildBurnCaptionsArgsOpts {
  videoPath: string;
  srtPath: string; // 已写好的 .srt 文件路径(不是字幕内容本身)
  outputPath: string;
}

/**
 * 用普通 .srt + ffmpeg 的 subtitles filter 烧录字幕(第一版实现，不做 .ass 动画字幕，
 * 详见 spec 风险表：这是既定的范围简化，不是遗漏)。
 */
export function buildBurnCaptionsArgs(opts: BuildBurnCaptionsArgsOpts): string[] {
  return ['-y', '-i', opts.videoPath, '-vf', `subtitles=${opts.srtPath}`, opts.outputPath];
}

export interface BurnCaptionsOpts {
  videoPath: string;
  srt: string; // SRT 格式字幕内容(不是文件路径)，内部负责写临时文件
  outputPath: string;
}

export async function burnCaptions(opts: BurnCaptionsOpts): Promise<void> {
  const srtPath = path.join(os.tmpdir(), `captions-${randomUUID()}.srt`);
  await fs.writeFile(srtPath, opts.srt, 'utf-8');
  try {
    await execFileAsync(
      FFMPEG_BIN,
      buildBurnCaptionsArgs({ videoPath: opts.videoPath, srtPath, outputPath: opts.outputPath }),
      { timeout: 600_000 },
    );
  } finally {
    await fs.unlink(srtPath).catch(() => {});
  }
}

export interface MuxAudioOpts {
  videoPath: string; // 只有画面(拼接后的 B-roll 序列)，可能有也可能没有原始音轨
  audioPath: string; // TTS 合成出的语音轨道
  outputPath: string;
}

/**
 * 把单独生成的音轨(TTS 配音)与无声(或原音轨被忽略)的视频混流：
 * 视频流直接 copy(不重新编码画面)，音频轨道来自 audioPath 独立编码为 aac，
 * 用 -shortest 保证输出时长以两者中较短的一方为准，避免音画对不齐的尾部空白/静音。
 */
export function buildMuxAudioArgs(opts: MuxAudioOpts): string[] {
  return [
    '-y',
    '-i', opts.videoPath,
    '-i', opts.audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-shortest',
    opts.outputPath,
  ];
}

export async function muxAudioTrack(opts: MuxAudioOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildMuxAudioArgs(opts), { timeout: 600_000 });
}
