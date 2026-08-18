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
