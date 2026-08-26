import { describe, expect, it } from 'vitest';
import { probeShotDensity, probeShotHealth } from '@/lib/video-production/shot-renderer';
import { judgeShotDensity } from '@/lib/video-production/frame-density';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * 真实跑 Chromium 渲染一帧再量密度 —— 不 mock。
 * 这个函数存在的意义就是"看见真实渲染结果", mock 掉等于什么都没验证。
 */

function page(body: string, bg = '#F6F4E9'): string {
  return `<!DOCTYPE html><html><head><style>
  body{margin:0;width:1920px;height:1080px;background:${bg};font-family:sans-serif}
  </style></head><body>${body}
  <script src='gsap.min.js'></script>
  <script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({},{duration:4});window.__timelines["shot"]=tl;</script>
  </body></html>`;
}

async function workDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shot-probe-'));
}

describe('probeShotDensity', () => {
  it('真正的空屏(什么都没渲出来)→ 被整镜判定拦下', async () => {
    // 阈值 2026-08-26 重标定后: 一行小字(约 5%)与参考视频的标题页同量级, 属正常构图,
    // 不该拦。这里用完全没有可见元素的页面 —— 那才是渲染事故。
    const dir = await workDir();
    const samples = await probeShotDensity({ html: page(''), durationMs: 4000, workDir: dir });

    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0].contentRatio).toBeLessThan(0.01);
    expect(judgeShotDensity(samples).ok).toBe(false);
  }, 120_000);

  it('一行小字的标题页 → 通过(与参考视频标题页同量级, 不是缺陷)', async () => {
    const dir = await workDir();
    const samples = await probeShotDensity({
      html: page('<div style="position:absolute;top:45%;left:35%;font-size:48px">为什么?</div>'),
      durationMs: 4000,
      workDir: dir,
    });
    expect(judgeShotDensity(samples).ok).toBe(true);
  }, 120_000);

  it('铺满内容的画面 → 通过判定', async () => {
    const dir = await workDir();
    const blocks = Array.from({ length: 24 }, (_, i) =>
      `<div style="display:inline-block;width:400px;height:150px;margin:12px;background:#2D2A26;color:#fff;font-size:28px">区块${i}</div>`).join('');
    const samples = await probeShotDensity({ html: page(blocks), durationMs: 4000, workDir: dir });

    expect(samples[0].contentRatio).toBeGreaterThan(0.2);
    expect(judgeShotDensity(samples).ok).toBe(true);
  }, 120_000);

  it('按镜头时长在中段取样 —— 避开开头结尾的入场/退场空档', async () => {
    const dir = await workDir();
    const samples = await probeShotDensity({ html: page('<p>x</p>'), durationMs: 6000, workDir: dir });
    // 至少取到 2 帧才谈得上"多数帧"裁决
    expect(samples.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('背景色被正确识别(亮底不当成内容)', async () => {
    const dir = await workDir();
    const samples = await probeShotDensity({ html: page('<p>x</p>', '#F9F6ED'), durationMs: 4000, workDir: dir });
    expect(samples[0].background).toBe('#F9F6ED');
  }, 120_000);

  it('页面脚本坏掉时不抛异常, 返回空样本(交给语法体检去管, 不在这里重复报错)', async () => {
    const dir = await workDir();
    const broken = `<!DOCTYPE html><html><body><script src='gsap.min.js'></script>
    <script>const c = f(el, #1F1F1F);</script></body></html>`;
    const samples = await probeShotDensity({ html: broken, durationMs: 4000, workDir: dir });
    expect(judgeShotDensity(samples).ok).toBe(true);
  }, 120_000);
});

describe('运行时错误捕获(真实出片踩过: t.duration is not a function)', () => {
  it('GSAP 用法错误 → 报告运行时错误, 而不是当成"画面太空"', async () => {
    const dir = await workDir();
    // 时间线挂上了、语法也对, 但 tl.to 的参数用法错误 —— 两道静态体检都拦不住
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;width:1920px;height:1080px;background:#F6F4E9}</style></head>
    <body><p>x</p><script src='gsap.min.js'></script>
    <script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
    tl.to('#nope', { duration: 1 }, {}); tl.seek(0); window.__timelines["shot"]=tl;
    document.body.appendChild(Object.assign(document.createElement('div'),{textContent:'y'}));
    undefinedFunctionCall();
    </script></body></html>`;
    const r = await probeShotHealth({ html, durationMs: 4000, workDir: dir });
    expect(r.runtimeErrors.length).toBeGreaterThan(0);
    expect(r.runtimeErrors.join(' ')).toMatch(/undefinedFunctionCall|not a function|not defined/);
  }, 120_000);

  it('正常页面 → 无运行时错误', async () => {
    const dir = await workDir();
    const r = await probeShotHealth({ html: page('<p>x</p>'), durationMs: 4000, workDir: dir });
    expect(r.runtimeErrors).toEqual([]);
    expect(r.samples.length).toBeGreaterThan(0);
  }, 120_000);

  it('seek 阶段抛错也会被收下 —— 有些错误只在跳转时才触发', async () => {
    const dir = await workDir();
    // 注: GSAP 会吞掉 eventCallback 里抛的异常, 那条路径测不出来。这里用"时间线对象
    // 本身不是合法 timeline"来触发 seek 阶段的报错 —— 与真实出片遇到的
    // `t.duration is not a function` 是同一类(结构体检放行、seek 时才炸)。
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;width:1920px;height:1080px;background:#F6F4E9}</style></head>
    <body><p>x</p><script src='gsap.min.js'></script>
    <script>window.__timelines=window.__timelines||{};
    window.__timelines["shot"]={ seek(){ throw new Error('seek 时炸了'); } };</script></body></html>`;
    const r = await probeShotHealth({ html, durationMs: 4000, workDir: dir });
    expect(r.runtimeErrors.join(' ')).toMatch(/seek 时炸了/);
    expect(r.samples).toEqual([]);
  }, 120_000);
});
