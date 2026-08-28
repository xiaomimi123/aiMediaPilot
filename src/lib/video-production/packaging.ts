import fs from 'fs/promises';
import path from 'path';
import { burnCaptions, mixBgm, attachIntroOutro, probeVideoDimensions } from '@/lib/video/ffmpeg';
import { buildAssCaptions, type CaptionEvent } from '@/lib/video-production/ass-captions';
import type { CaptionStyle } from '@/lib/video-template/model';

export interface PackagingOptions {
  captionStyle: CaptionStyle | null;
  captionEvents: CaptionEvent[];
  bgmPath: string | null;
  bgmVolume: number;
  introPath: string | null;
  outroPath: string | null;
}

export function needsPackaging(opts: PackagingOptions): boolean {
  const hasCaptions = Boolean(opts.captionStyle) && opts.captionEvents.length > 0;
  return hasCaptions || Boolean(opts.bgmPath) || Boolean(opts.introPath) || Boolean(opts.outroPath);
}

/**
 * 成片包装段(二十期) —— 三交付模式共用, 只在 master 渲染完成后执行(预览不包装, spec §3.1)。
 * 顺序固定 字幕 → BGM → 片头片尾: 片头片尾自带声画, 放最后才不会被字幕和 BGM 渗到。
 * 每步的输入是上一步的输出, 中间产物落在 workDir 内, 便于失败时定位到底哪一步崩的。
 */
export async function runPackaging(input: {
  masterPath: string;
  workDir: string;
  outputPath: string;
  options: PackagingOptions;
  onStep?: (step: string) => Promise<void>;
}): Promise<void> {
  const { masterPath, workDir, outputPath, options, onStep } = input;

  if (!needsPackaging(options)) {
    await fs.copyFile(masterPath, outputPath);
    return;
  }

  const steps: Array<{ name: string; label: string; run: (inPath: string, outPath: string) => Promise<void> }> = [];

  // 字幕要按真实画面尺寸定字号 —— 探一次, 探不到就不写 PlayRes(退回老行为,
  // 字会偏大, 但至少不会因为探测失败整条流程崩掉)
  let frame: { width: number; height: number } | undefined;
  if (options.captionStyle && options.captionEvents.length > 0) {
    try {
      frame = await probeVideoDimensions(masterPath);
    } catch {
      frame = undefined;
    }
  }

  if (options.captionStyle && options.captionEvents.length > 0) {
    const style = options.captionStyle;
    const events = options.captionEvents;
    steps.push({
      name: 'captions',
      label: '字幕烧录',
      run: (inPath, outPath) =>
        burnCaptions({
          videoPath: inPath,
          // 探真实尺寸传给 ASS: 没有 PlayRes 时 libass 按 384×288 解释字号, 竖屏
          // 成片上等于把字放大 6.67 倍(真机第一条片子就是这么糊掉的)
          srt: buildAssCaptions(events, style, frame),
          outputPath: outPath,
          format: 'ass',
        }),
    });
  }

  if (options.bgmPath) {
    const bgmPath = options.bgmPath;
    steps.push({
      name: 'bgm',
      label: 'BGM 混音',
      run: (inPath, outPath) =>
        mixBgm({ videoPath: inPath, bgmPath, bgmVolume: options.bgmVolume, outputPath: outPath }),
    });
  }

  if (options.introPath || options.outroPath) {
    steps.push({
      name: 'intro-outro',
      label: '片头片尾拼接',
      run: (inPath, outPath) =>
        attachIntroOutro({
          videoPath: inPath,
          introPath: options.introPath,
          outroPath: options.outroPath,
          outputPath: outPath,
        }),
    });
  }

  let current = masterPath;
  const intermediates: string[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const isLast = i === steps.length - 1;
    const stepOutput = isLast ? outputPath : path.join(workDir, `packaging-${step.name}.mp4`);
    if (onStep) await onStep(step.name);
    try {
      await step.run(current, stepOutput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 中途失败时不清理: 中间产物是排查"崩在哪一步"的现场证据。
      throw new Error(`成片包装失败于「${step.label}」步骤: ${msg}`);
    }
    if (!isLast) intermediates.push(stepOutput);
    current = stepOutput;
  }

  // 只删本函数自己产生的中间文件 —— masterPath(包装失败时的兜底交付物)与 outputPath
  // 都不在这个列表里。删不掉只是留下垃圾文件, 不该让已经成功的包装反过来失败。
  await Promise.all(intermediates.map((p) => fs.unlink(p).catch(() => {})));
}
