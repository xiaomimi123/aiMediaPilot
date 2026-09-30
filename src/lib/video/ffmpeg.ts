import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
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

export interface VideoDimensions {
  width: number;
  height: number;
}

export function buildProbeDimensionsArgs(videoPath: string): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', videoPath];
}

export function parseProbeDimensionsOutput(stdout: string): VideoDimensions {
  const json = JSON.parse(stdout);
  const stream = json?.streams?.[0];
  if (!stream || typeof stream.width !== 'number' || typeof stream.height !== 'number') {
    throw new Error('ffprobe output missing width/height');
  }
  return { width: stream.width, height: stream.height };
}

/**
 * 探测视频画面宽高（真实走查发现：真人出镜素材(如手机竖拍 2160x3840)与
 * Builder 固定产出的 1920x1080 横屏 B-roll 分镜尺寸不一致，`compositeCutawayVideo`
 * 挖空替换合成时 concat filter 要求参与拼接的所有视频流尺寸严格一致，否则直接报错退出。
 * 需要先知道源视频真实宽高，才能把 B-roll 分镜缩放/加黑边对齐到同一尺寸。
 */
export async function probeVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, buildProbeDimensionsArgs(videoPath), { timeout: 30_000 });
  return parseProbeDimensionsOutput(stdout);
}

/**
 * 探测视频时长(毫秒)。
 *
 * 给「分镜有没有排到素材之外」这个校验用 —— 真实事故里导演给 155 秒的素材排出了
 * 234 秒的分镜, 合成照单全收。**探不到返回 null 而不是抛错**: 调用方的规则是
 * 「拿不到时长就不裁」, 宁可不裁也不要凭空裁掉真实内容。
 */
export async function probeVideoDurationMs(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath],
      { timeout: 30_000 },
    );
    const sec = Number(stdout.trim());
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null;
  } catch {
    return null;
  }
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

export interface ConcatAudioOpts {
  audioPaths: string[];
  outputPath: string;
  concatListPath: string;
}

/**
 * 纯音频拼接专用参数 —— 与 buildConcatArgs 共用 concat demuxer 的基本形状(同一份
 * concat-list 文件写法)，但**不能**沿用 `-c copy`。`-c copy` 是 bitstream 级直接拼
 * 字节，对 mp3/aac 这类帧编码在拼接点上不是采样点精确的(实测两段 TTS mp3 拼接会有
 * ~64ms 的时长漂移 + `Non-monotonic DTS` 警告)，会导致后续按每幕音频时长算出的
 * alignedActs 边界与实际拼接音轨的边界对不上、随幕数增多累积成画面渐进错位。
 * 这里显式指定 `-c:a pcm_s16le` 强制 ffmpeg 对 concat demuxer 的每个输入做真实解码
 * 再重新编码为 PCM，拼接点上不再有帧边界对不齐的问题，用可接受的一次性重编码开销
 * 换取采样点精确对齐。
 */
export function buildConcatAudioArgs(opts: ConcatAudioOpts): string[] {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', opts.concatListPath,
    '-c:a', 'pcm_s16le',
    opts.outputPath,
  ];
}

export async function concatAudioTracks(opts: ConcatAudioOpts): Promise<void> {
  const listContent = opts.audioPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  await fs.writeFile(opts.concatListPath, listContent, 'utf-8');
  await execFileAsync(FFMPEG_BIN, buildConcatAudioArgs(opts), { timeout: 600_000 });
}
