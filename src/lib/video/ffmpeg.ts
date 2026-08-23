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
 * `buildCompositeCutawayArgs` 专用扩展：真实源视频的画面宽高。B-roll 分镜由
 * `renderShotToClip` 固定按 1920x1080 渲染(与 Builder 提示词的画布尺寸契约一致，见
 * `builder-prompt.ts`)，但真人出镜素材常见不是这个尺寸——尤其是手机竖拍的抖音口播
 * (真实走查用的 iPhone 素材是 2160x3840 竖屏)。concat filter 要求参与拼接的所有
 * 视频流尺寸严格一致，尺寸不一致会直接报错退出(真实走查复现过这个崩溃：
 * `Input link ... parameters (size 2160x3840 ...) do not match ... (1920x1080 ...)`).
 * 调用方(`compositeCutawayVideo`)先用 `probeVideoDimensions` 探测源视频真实宽高，
 * 再传进来，纯函数本身不做任何探测(保持可脱离真实文件系统单测)。
 */
export interface CompositeCutawayArgsOpts extends CompositeCutawayOpts {
  sourceWidth: number;
  sourceHeight: number;
  /**
   * 源视频总时长(毫秒), 可选。提供时用于识别"最后一个 segment 的 endMs 恰好到达
   * (或超过)源视频末尾"的边界——此时不再生成零长度的开放尾段 trim(concat filter
   * 会因空片段报错退出)。不提供时保持原行为(始终生成尾段)。
   */
  sourceDurationMs?: number;
}

/**
 * 挖空替换合成：把 sourceVideoPath 按 segments 时间点切成"原始片段/替换片段"交替序列，
 * 用 concat filter 拼成一条连续画面流；音频轨道始终整段直接用源文件的原始音轨，不做任何切分——
 * 画面切到 B-roll 期间，人声依然连续播放。
 *
 * B-roll 时长对齐策略：每个 B-roll 输入都以 `-stream_loop -1` 打开(无限循环该输入文件)，
 * 再在 filter 里用 `trim=0:<segment 目标时长>` 精确截到 segment 需要的长度——
 * 这样无论 B-roll 素材本身比 segment 短(会被循环补齐)还是比 segment 长(会被直接截断)都能正确处理，
 * 不需要提前判断素材实际时长。B-roll 分镜的固定 1920x1080 画布再用 `scale`+`pad` 缩放/加黑边对齐到
 * 源视频真实尺寸(等比缩放不拉伸变形, 多出的空间用黑边填充), 源视频自身片段不做任何缩放(保持原画质)。
 *
 * 已知局限：如果某个 segment 的 endMs 恰好等于源视频总时长，尾部会生成一段 `trim=start=<end>`
 * (无 end 参数、理论上长度为 0) 的片段传给 concat，可能导致 ffmpeg 报错。当前实现未特殊处理这个
 * 边界(需要提前 ffprobe 源时长才能识别)，如果实际使用中遇到该场景需要额外处理。
 */
export function buildCompositeCutawayArgs(opts: CompositeCutawayArgsOpts): string[] {
  const indexed = opts.segments.map((seg, i) => ({ ...seg, inputIndex: i + 1 }));
  const sorted = [...indexed].sort((a, b) => a.startMs - b.startMs);

  const inputArgs: string[] = ['-y', '-i', opts.sourceVideoPath];
  for (const seg of indexed) {
    inputArgs.push('-stream_loop', '-1', '-i', seg.clipPath);
  }

  if (sorted.length === 0) {
    // 没有 segment：原样直通源视频的视频流与音频流。
    // `0:a:0` 而非 `0:a`：真实 iPhone 录制的 .mov 常见不止一条音轨(如 iPhone 17 Pro Max
    // 除标准 stereo AAC 外还会带一条 apple_apac 空间音频轨), `-map 0:a` 会把所有匹配的音频流
    // 都映射进输出——ffmpeg 本机版本没有 apple_apac 解码器，整个命令直接报错退出。
    // 只取索引 0 (即源文件里排第一的音轨, 实测就是人声主音轨) 规避这个问题。
    return [...inputArgs, '-map', '0:v', '-map', '0:a:0', '-c:v', 'libx264', '-c:a', 'aac', opts.outputPath];
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
    const { sourceWidth: W, sourceHeight: H } = opts;
    filterParts.push(
      `[${seg.inputIndex}:v]trim=start=0:end=${durSec},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${label}]`,
    );
    concatLabels.push(`[${label}]`);
    pieceIdx++;
    cursorMs = seg.endMs;
  }

  // 尾段：从最后一个 segment 结束到源视频结尾(不带 end 参数，trim 自动取到输入末尾)。
  // 提供了 sourceDurationMs 且最后一个 segment 已顶到(或超过)源视频末尾时跳过——
  // 否则会生成零长度的空 trim 段传给 concat, 部分 ffmpeg 版本会直接报错退出。
  if (opts.sourceDurationMs === undefined || cursorMs < opts.sourceDurationMs) {
    const tailLabel = `s${pieceIdx}`;
    filterParts.push(`[0:v]trim=start=${cursorMs / 1000},setpts=PTS-STARTPTS[${tailLabel}]`);
    concatLabels.push(`[${tailLabel}]`);
  }

  const concatFilter = `${concatLabels.join('')}concat=n=${concatLabels.length}:v=1:a=0[outv]`;
  filterParts.push(concatFilter);

  return [
    ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    // `0:a:0` 而非 `0:a`：同上——多音轨源文件下只取第一条音轨，避免 ffmpeg 因缺少
    // 副音轨(如 apple_apac)解码器而整体失败。
    '-map', '0:a:0',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    opts.outputPath,
  ];
}

export async function compositeCutawayVideo(opts: CompositeCutawayOpts): Promise<void> {
  const { width: sourceWidth, height: sourceHeight } = await probeVideoDimensions(opts.sourceVideoPath);
  const { durationSec } = await probeVideo(opts.sourceVideoPath);
  const sourceDurationMs = Math.round(durationSec * 1000);
  await execFileAsync(
    FFMPEG_BIN,
    buildCompositeCutawayArgs({ ...opts, sourceWidth, sourceHeight, sourceDurationMs }),
    { timeout: 600_000 },
  );
}

export interface BuildBurnCaptionsArgsOpts {
  videoPath: string;
  srtPath: string; // 已写好的 .srt 文件路径(不是字幕内容本身)
  outputPath: string;
}

/**
 * subtitles filter 的文件路径要过 ffmpeg 两层解析：先是 filtergraph 级(按未转义的
 * `,;[]'\` 切分 filter 链)，再是选项级(按 `:` 切分选项、识别 `'...'` 引号)。
 * 路径里的特殊字符(尤其空格/单引号/逗号/方括号)不转义会导致解析错位或直接打不开文件。
 * 两级转义方案：选项级先用单引号整体包裹(内部单引号以 '\'' 逃出)，再对结果做
 * filtergraph 级转义(`\ ' , ; [ ]` 各加 `\` 前缀)。
 */
function escapeSubtitlesFilterPath(p: string): string {
  const optionQuoted = `'${p.replace(/'/g, "'\\''")}'`;
  return optionQuoted.replace(/([\\',;[\]])/g, '\\$1');
}

/**
 * 用普通 .srt + ffmpeg 的 subtitles filter 烧录字幕(第一版实现，不做 .ass 动画字幕，
 * 详见 spec 风险表：这是既定的范围简化，不是遗漏)。
 */
export function buildBurnCaptionsArgs(opts: BuildBurnCaptionsArgsOpts): string[] {
  return ['-y', '-i', opts.videoPath, '-vf', `subtitles=${escapeSubtitlesFilterPath(opts.srtPath)}`, opts.outputPath];
}

export interface BurnCaptionsOpts {
  videoPath: string;
  srt: string; // 字幕内容(不是文件路径)，内部负责写临时文件
  outputPath: string;
  /**
   * 字幕格式。默认 'srt' —— 旧调用方(十九期真人出镜默认字幕)零改动。
   * 'ass' 时临时文件写 .ass 扩展名: libass 靠扩展名选解析器, 写成 .srt 会把
   * 整个 ASS 头部当成字幕正文渲染出来。
   */
  format?: 'srt' | 'ass';
}

export async function burnCaptions(opts: BurnCaptionsOpts): Promise<void> {
  const ext = opts.format === 'ass' ? 'ass' : 'srt';
  const srtPath = path.join(os.tmpdir(), `captions-${randomUUID()}.${ext}`);
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

export function buildProbeAudioStreamArgs(videoPath: string): string[] {
  return ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'json', videoPath];
}

export function parseHasAudioStream(stdout: string): boolean {
  try {
    const json = JSON.parse(stdout);
    return Array.isArray(json?.streams) && json.streams.length > 0;
  } catch {
    return false;
  }
}

/** 探测视频是否带音轨 —— 决定 BGM 是与人声 amix 还是直接作为唯一音轨。 */
export async function hasAudioStream(videoPath: string): Promise<boolean> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, buildProbeAudioStreamArgs(videoPath), { timeout: 30_000 });
  return parseHasAudioStream(stdout);
}

export interface MixBgmOpts {
  videoPath: string;
  bgmPath: string;
  bgmVolume: number; // 0~1, BGM 相对音量
  outputPath: string;
  hasVoiceTrack: boolean; // 正片是否已有人声音轨(由 hasAudioStream 探测)
}

/**
 * BGM 混音。BGM 素材通常比正片短, 用 `-stream_loop -1` 无限循环该输入补齐;
 * 长度靠 amix 的 `duration=first`(以人声为准)或 `-shortest`(无人声时以画面为准)收敛,
 * 不需要提前知道 BGM 实际时长。画面 `-c:v copy` 不重编码(混音不动画面, 省一次转码)。
 * v1 用固定音量不做 sidechain 自动闪避(spec §3.3: 效果可预期, 闪避列为后续可选)。
 */
export function buildMixBgmArgs(opts: MixBgmOpts): string[] {
  // `0:a:0`/`1:a:0` 而非 `0:a`/`1:a`：与 `compositeCutawayVideo`/`buildConcatArgs`
  // 同源的既定约定——真实 iPhone 出镜素材(.mov)常带多条音轨(如 apple_apac 空间音频
  // 副轨，本机 ffmpeg 无解码器)，BGM 混音必然作用在同一批出镜素材上，显式只取每路
  // 输入的第一条音频流，不依赖 filtergraph 标签在有歧义时"静默取第一条"的未文档化行为。
  const filter = opts.hasVoiceTrack
    ? `[1:a:0]volume=${opts.bgmVolume}[bgm];[0:a:0][bgm]amix=inputs=2:duration=first:dropout_transition=0[outa]`
    : `[1:a:0]volume=${opts.bgmVolume}[outa]`;

  return [
    '-y',
    '-i', opts.videoPath,
    '-stream_loop', '-1', '-i', opts.bgmPath,
    '-filter_complex', filter,
    '-map', '0:v:0',
    '-map', '[outa]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    ...(opts.hasVoiceTrack ? [] : ['-shortest']),
    opts.outputPath,
  ];
}

export async function mixBgm(opts: Omit<MixBgmOpts, 'hasVoiceTrack'>): Promise<void> {
  const hasVoiceTrack = await hasAudioStream(opts.videoPath);
  await execFileAsync(FFMPEG_BIN, buildMixBgmArgs({ ...opts, hasVoiceTrack }), { timeout: 600_000 });
}

export interface ConcatWithReencodeOpts {
  videoPaths: string[];
  targetWidth: number;
  targetHeight: number;
  outputPath: string;
  /**
   * 每一路是否含音轨(与 videoPaths 顺序对应), 省略的路视为"有音轨"。
   *
   * 真实验证偏差(与本任务 brief 字面不同, 有依据): brief 原方案对每一路都用
   * `[i:a?]` 可选流标记, 指望没有音轨的输入被 ffmpeg 静默跳过、只留 anullsrc 参与
   * amix。本机真实 ffmpeg 9.0.1 实测: 当某路输入确实不存在音频流时, `?` 在
   * `-filter_complex` 里不生效, 直接报错退出——
   * `Stream specifier ':a?' in filtergraph description ... matches no streams.`
   * (`?` 是 `-map` 选项的语义, 不是 filtergraph linklabel 的语义; 同一条流若真实
   * 存在, `[i:a?]` 能正常工作, 只有"确实不存在"这个分支会炸)。因此不能像
   * `buildCompositeCutawayArgs` 那样在纯函数内部对音轨存在性做静默假设——必须由
   * 调用方(`attachIntroOutro`)先用 `hasAudioStream` 逐路探测, 显式告知每一路有没有
   * 音轨, 纯函数据此决定该路是 `amix` 真实音轨与静音, 还是直接把 anullsrc 当作该路
   * 音轨(不引用任何不存在的 `i:a` 流)。
   */
  hasAudioFlags?: boolean[];
  /**
   * 每一路的真实时长(秒, 与 videoPaths 顺序对应), 用于把该路的 anullsrc 裁剪到
   * 对应长度。真实验证发现的第二处偏差: anullsrc 输入固定开 `-t 3600` 兜底"够长",
   * 对无音轨路(`hasAudioFlags[i] === false`)直接把这路静音源重打标签当整段音轨时,
   * concat filter 的 a=1 段落要等该段所有流都到 EOF 才切下一段——静音源不裁剪的话
   * 整体输出时长会被拖到 3600s+ 量级(真实集成测试复现: 输出探测到 durationSec≈3606,
   * 而不是预期的 ~8)。省略时保留原始未裁剪行为(仅用于无需真实执行的纯函数单测)。
   */
  durationsSec?: number[];
}

/**
 * 重编码式拼接 —— 用于把片头/正片/片尾这类**非同源**素材接在一起。
 * 与 `buildConcatArgs`(concat demuxer + `-c copy`)的关键差异:
 * - `-c copy` 只对同一渲染器产出、编码参数严格一致的分镜安全; 用户自己上传的
 *   片头片尾编码参数任意, 字节拼接会漂移甚至直接失败(十九期已实测, 见 buildConcatAudioArgs 注释)。
 * - concat filter 要求所有输入流尺寸/SAR 严格一致, 所以每一路都 scale+pad 到正片尺寸
 *   (等比缩放不变形, 多余空间补黑边)。
 * - 无音轨的片段参与 `concat=a=1` 会直接报错, 所以每一路都额外开一个 anullsrc 静音输入
 *   兜底; 有音轨的路与静音 amix(听感不变), 没音轨的路直接把静音源当作该路音轨
 *   (`hasAudioFlags` 的由来见上方接口注释)。
 */
export function buildConcatWithReencodeArgs(opts: ConcatWithReencodeOpts): string[] {
  const { targetWidth: W, targetHeight: H } = opts;
  const inputArgs: string[] = ['-y'];
  const filterParts: string[] = [];
  const concatLabels: string[] = [];

  opts.videoPaths.forEach((p, i) => {
    inputArgs.push('-i', p);
    // 每个真实输入后紧跟一路无限长的静音源(靠 concat 的 v/a 段长度收敛, 不会拖长输出)
    inputArgs.push('-f', 'lavfi', '-t', '3600', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    const vIn = i * 2;
    const aNull = i * 2 + 1;
    filterParts.push(
      `[${vIn}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v${i}]`,
    );
    const dur = opts.durationsSec?.[i];
    let anullRef = `${aNull}:a`;
    if (dur !== undefined) {
      filterParts.push(`[${aNull}:a]atrim=0:${dur},asetpts=PTS-STARTPTS[an${i}]`);
      anullRef = `an${i}`;
    }

    const hasAudio = opts.hasAudioFlags ? opts.hasAudioFlags[i] !== false : true;
    if (hasAudio) {
      // `${vIn}:a:0` 而非 `${vIn}:a`: 与 `compositeCutawayVideo`/`buildMixBgmArgs`
      // 同源的既定约定——用户上传的片头片尾若是 iPhone 直出的 .mov, 可能带 apple_apac
      // 空间音频副轨, 显式只取每路输入的第一条音频流, 不依赖 filtergraph 标签在
      // 有歧义时"静默取第一条"的未文档化行为。
      filterParts.push(
        `[${vIn}:a:0][${anullRef}]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[a${i}]`,
      );
    } else {
      // 不引用 `[${vIn}:a:0]` —— 该路确实没有音频流, 直接把(裁剪过的)静音源重打标签当作该路音轨。
      filterParts.push(`[${anullRef}]anull[a${i}]`);
    }
    concatLabels.push(`[v${i}][a${i}]`);
  });

  filterParts.push(`${concatLabels.join('')}concat=n=${opts.videoPaths.length}:v=1:a=1[outv][outa]`);

  return [
    ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    opts.outputPath,
  ];
}

export interface AttachIntroOutroOpts {
  videoPath: string;
  introPath?: string | null;
  outroPath?: string | null;
  outputPath: string;
}

/**
 * 把片头/片尾接到正片前后。两者都没配时直接把正片复制到 outputPath(不白跑一次转码)。
 * 目标尺寸取**正片**的真实尺寸 —— 片头片尾迁就正片, 而不是反过来。
 */
export async function attachIntroOutro(opts: AttachIntroOutroOpts): Promise<void> {
  const paths = [opts.introPath, opts.videoPath, opts.outroPath].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  if (paths.length === 1) {
    await fs.copyFile(opts.videoPath, opts.outputPath);
    return;
  }
  const { width, height } = await probeVideoDimensions(opts.videoPath);
  // 逐路探测音轨存在性 —— 原因见 `ConcatWithReencodeOpts.hasAudioFlags` 注释:
  // 真实 ffmpeg 不接受在 filtergraph 里对确实不存在的流用 `?` 静默跳过。
  // 逐路探测真实时长 —— 原因见 `ConcatWithReencodeOpts.durationsSec` 注释:
  // 无音轨路的 anullsrc 不裁剪到该路真实时长, concat 会被拖到静音源的 3600s 长度。
  const [hasAudioFlags, durationsSec] = await Promise.all([
    Promise.all(paths.map((p) => hasAudioStream(p))),
    Promise.all(paths.map((p) => probeVideo(p).then((r) => r.durationSec))),
  ]);
  await execFileAsync(
    FFMPEG_BIN,
    buildConcatWithReencodeArgs({
      videoPaths: paths,
      targetWidth: width,
      targetHeight: height,
      hasAudioFlags,
      durationsSec,
      outputPath: opts.outputPath,
    }),
    { timeout: 900_000 },
  );
}
