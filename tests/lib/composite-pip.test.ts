import { describe, it, expect } from 'vitest';
import { buildCompositeCutawayArgs } from '@/lib/video/ffmpeg';

const base = {
  sourceVideoPath: 'src.mov',
  outputPath: 'out.mp4',
  sourceWidth: 1080,
  sourceHeight: 1920,
  segments: [{ startMs: 2000, endMs: 5000, clipPath: 'b1.mp4' }],
};

const filterOf = (args: string[]): string => {
  const i = args.findIndex((a) => a === '-filter_complex');
  return i >= 0 ? args[i + 1] : '';
};

describe('挖空模式（不给 pip）', () => {
  it('B-roll 段整段替换, 没有 overlay', () => {
    const f = filterOf(buildCompositeCutawayArgs(base));
    expect(f).not.toContain('overlay');
  });

  it('输出标签不变 —— 老任务字符级不受影响', () => {
    const f = filterOf(buildCompositeCutawayArgs(base));
    expect(f).toContain('[b1]');
    expect(f).not.toContain('b1bg');
  });
});

describe('画中画模式', () => {
  const pipArgs = buildCompositeCutawayArgs({
    ...base,
    pip: { position: 'br', scale: 0.25, margin: 40 },
  });
  const f = filterOf(pipArgs);

  it('B-roll 铺底, 源视频缩成小窗叠上去', () => {
    expect(f).toContain('[b1bg]');
    expect(f).toContain('[b1pip]');
    expect(f).toContain('overlay=');
  });

  it('**小窗取源视频同一时间段** —— 从 0 开始的话小窗放的是片头, 口型全错', () => {
    expect(f).toContain('[0:v]trim=start=2:end=5');
  });

  it('小窗尺寸按比例算, 位置在右下', () => {
    expect(f).toContain('scale=270:480');
    expect(f).toContain(`overlay=${1080 - 270 - 40}:${1920 - 480 - 40}`);
  });

  it('overlay 的产物才是拼接用的标签', () => {
    expect(f).toContain('[b1bg][b1pip]overlay=');
    expect(f).toContain('[b1]');
  });

  it('音轨仍然整段直取源文件 —— 画面切走时人声不能断', () => {
    expect(pipArgs).toContain('0:a:0');
  });
});
