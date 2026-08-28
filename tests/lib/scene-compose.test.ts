import { describe, it, expect } from 'vitest';
import { buildSceneComposeArgs, type SceneSegment } from '@/lib/video/scene-compose';

const frame = { width: 1080, height: 1920 };
const base = { sourceVideoPath: 'src.mov', outputPath: 'out.mp4', frame, sourceDurationMs: 30000 };
const seg = (over: Partial<SceneSegment> = {}): SceneSegment => ({
  startMs: 2000, endMs: 6000, clipPath: 'b1.mp4', layout: 'content-full', ...over,
});

const filterOf = (args: string[]): string => {
  const i = args.indexOf('-filter_complex');
  return i >= 0 ? args[i + 1] : '';
};

describe('buildSceneComposeArgs', () => {
  it('人物全屏: 原样直通, 不缩放也不叠加 —— 保持原画质', () => {
    const f = filterOf(buildSceneComposeArgs({ ...base, segments: [seg({ layout: 'person-full' })] }));
    expect(f).toContain('[0:v]trim=start=2:end=6');
    expect(f).not.toContain('overlay');
    expect(f).not.toContain('scale=');
  });

  it('**人物全屏不占输入位** —— 白占会让后面所有 clip 的输入索引错位', () => {
    const args = buildSceneComposeArgs({
      ...base,
      segments: [seg({ layout: 'person-full', startMs: 0, endMs: 2000 }), seg({ layout: 'content-full' })],
    });
    // 只有一个 -stream_loop 输入
    expect(args.filter((a) => a === '-stream_loop')).toHaveLength(1);
    expect(filterOf(args)).toContain('[1:v]');
    expect(filterOf(args)).not.toContain('[2:v]');
  });

  it('内容全屏: 等比放进画面并补黑边 —— 整幅画面不能裁掉观众要看的内容', () => {
    const f = filterOf(buildSceneComposeArgs({ ...base, segments: [seg()] }));
    expect(f).toContain('force_original_aspect_ratio=decrease');
    expect(f).toContain('pad=1080:1920');
  });

  it('**分屏用 cover 不用 contain** —— 窄长区里 contain 会变成加了黑边的小图', () => {
    const f = filterOf(buildSceneComposeArgs({ ...base, segments: [seg({ layout: 'content-left' })] }));
    expect(f).toContain('force_original_aspect_ratio=increase');
    expect(f).toContain('crop=');
    expect(f).not.toContain('pad=1080:1920');
  });

  it('分屏先铺黑底再叠两块 —— 两块之间有留白, 没底会露出前一帧', () => {
    const f = filterOf(buildSceneComposeArgs({ ...base, segments: [seg({ layout: 'content-right' })] }));
    expect(f).toContain('color=c=black:s=1080x1920');
    expect((f.match(/overlay=/g) ?? []).length).toBe(2);
  });

  it('圆窗: B-roll 铺满 + 圆形遮罩的人像叠在右下', () => {
    const f = filterOf(buildSceneComposeArgs({ ...base, segments: [seg({ layout: 'person-circle' })] }));
    expect(f).toContain('geq');
    expect(f).toContain('format=rgba');
    expect(f).toContain('overlay=');
  });

  it('段与段之间的空隙用源视频补上 —— 少一段 concat 就对不齐时间', () => {
    const f = filterOf(buildSceneComposeArgs({
      ...base,
      segments: [seg({ startMs: 5000, endMs: 8000 })],
    }));
    expect(f).toContain('[0:v]trim=start=0:end=5');
  });

  it('尾段接到片尾', () => {
    const f = filterOf(buildSceneComposeArgs({ ...base, segments: [seg()] }));
    expect(f).toContain('trim=start=6,setpts');
  });

  it('**最后一段顶到片尾时不生成尾段** —— 零长片段会让 concat 报错', () => {
    const f = filterOf(buildSceneComposeArgs({
      ...base,
      segments: [seg({ startMs: 0, endMs: 30000 })],
    }));
    expect(f).not.toContain('trim=start=30,setpts');
  });

  it('concat 的段数和标签数一致', () => {
    const f = filterOf(buildSceneComposeArgs({
      ...base,
      segments: [seg({ startMs: 0, endMs: 3000 }), seg({ startMs: 5000, endMs: 9000, layout: 'content-left' })],
    }));
    const m = /concat=n=(\d+)/.exec(f)!;
    const labels = f.slice(f.lastIndexOf(';') + 1).match(/\[[a-z0-9]+\]/g)!;
    // 最后一条是 concat, 它前面的标签数 = n(去掉输出的 [vout])
    expect(labels.length - 1).toBe(Number(m[1]));
  });

  it('音轨整段直取源文件第一条 —— 画面切走时人声不能断, 也不能映射到空间音频轨', () => {
    const args = buildSceneComposeArgs({ ...base, segments: [seg()] });
    expect(args).toContain('0:a:0');
    expect(args).not.toContain('0:a');
  });

  it('没有任何段时直通源视频', () => {
    const args = buildSceneComposeArgs({ ...base, segments: [] });
    expect(args).toContain('0:v');
    expect(args).not.toContain('-filter_complex');
  });
});
