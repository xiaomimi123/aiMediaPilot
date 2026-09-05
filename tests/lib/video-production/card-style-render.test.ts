import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, hexToRgb, manhattan, regionContainsColor } from './_ppm-test-utils';
import { THEMES } from '../../../remotion/src/theme';

/*
 * style 是否真的作用到画面 —— 断言 JSX 没有意义(参数可能被读了却没用),
 * 只有真渲染出两张图、比像素才说明问题。手法照 remotion-source-video.test.ts。
 * 见 task-3-brief.md Step 1。
 */
const shot = (style?: unknown) => ({
  shotId: 's1', startMs: 0, endMs: 4000, card: 'statement' as const,
  slots: { text: '强调色测试', sub: '副句' }, ...(style ? { style } : {}),
});

const renderAt = async (style: unknown, name: string) => {
  const out = path.join(os.tmpdir(), `style-${name}-${Date.now()}.png`);
  await renderShotStill({
    input: {
      shots: [shot(style)] as never, audioSrc: null, bgm: null, captions: [],
      sourceVideo: null, aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs: 2000, outputPath: out,
  });
  return out;
};

describe('style 真的作用到画面', () => {
  it('accent 不同 → 像素不同', async () => {
    const a = await renderAt(undefined, 'default');
    const b = await renderAt({ accent: 'red' }, 'red');
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    fs.unlinkSync(a); fs.unlinkSync(b);
  }, 120_000);

  it('scale 不同 → 像素不同', async () => {
    const a = await renderAt(undefined, 's1');
    const b = await renderAt({ scale: 1.4 }, 's14');
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    fs.unlinkSync(a); fs.unlinkSync(b);
  }, 120_000);

  it('speed 不同 → 同一时刻的动效进度不同 → 像素不同', async () => {
    // atMs 取动效进行中的时刻(0.3s 起, 0.42s 时长 —— 500ms 处正在动)
    const out1 = path.join(os.tmpdir(), `sp1-${Date.now()}.png`);
    const out2 = path.join(os.tmpdir(), `sp2-${Date.now()}.png`);
    const mk = async (style: unknown, o: string) => renderShotStill({
      input: {
        shots: [shot(style)] as never, audioSrc: null, bgm: null, captions: [],
        sourceVideo: null, aspect: '16:9', visualStyle: 'card',
      }, shotIndex: 0, atMs: 500, outputPath: o,
    });
    await mk(undefined, out1);
    await mk({ speed: 3 }, out2);
    expect(fs.readFileSync(out1).equals(fs.readFileSync(out2))).toBe(false);
    fs.unlinkSync(out1); fs.unlinkSync(out2);
  }, 120_000);

  /*
   * 复审补测: accent 色板必须"限定在主题 token 内"(spec §4.1), 不能是一份
   * 跨主题共用的全局鲜色——否则 illustration 主题(暖纸底, accent 特意柔化成
   * C.lightBlue)下选"蓝", 会跳出该主题的柔和色系, 变成刺眼的全局蓝
   * (`resolveAccent` 最初的实现就是这么写的, 已改成从 `theme.accents` 取)。
   *
   * 只断言"整图像素不同"堵不住这个 bug ——即便 `resolveAccent` 恒返回同一个
   * 全局蓝(bug 复现), card / illustration 两套主题的背景色、标题色本来就不同,
   * 整图 diff 恒为真, 假阳性地"通过"。真正要钉住的是: **card 渲染里出现的是
   * `theme.accents.blue`(鲜色), illustration 渲染里出现的是它自己的
   * `theme.accents.blue`(柔化色), 且两者互不出现在对方的画面里**——用
   * `regionContainsColor` 在全帧范围内找"主文案下面那条 sweepHighlight 强调条"
   * 的颜色(纯色矩形, 不透明, 不会被背景混色, 比取样文字本身更稳)。
   */
  it('accent 解析出的颜色被限定在各自主题 token 内(不是跨主题共用的全局鲜色)', async () => {
    const renderWithVisualStyle = async (visualStyle: 'card' | 'illustration', name: string) => {
      const png = path.join(os.tmpdir(), `theme-accent-${name}-${Date.now()}.png`);
      const ppm = png.replace(/\.png$/, '.ppm');
      await renderShotStill({
        input: {
          shots: [shot({ accent: 'blue' })] as never, audioSrc: null, bgm: null, captions: [],
          sourceVideo: null, aspect: '16:9', visualStyle,
        },
        shotIndex: 0, atMs: 2000, outputPath: png,
      });
      execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
      const img = parsePpm(fs.readFileSync(ppm));
      fs.unlinkSync(png); fs.unlinkSync(ppm);
      return img;
    };

    const cardImg = await renderWithVisualStyle('card', 'card');
    const illuImg = await renderWithVisualStyle('illustration', 'illustration');

    // 弱校验(最低限度): 两张图整体确实不同——两套主题背景/标题本来就不同,
    // 这条恒真, 单独存在时抓不住 bug, 但留着作为最基础的冒烟检查。
    expect(cardImg.data.equals(illuImg.data)).toBe(false);

    // 强校验: 具体颜色值必须落在各自主题的 token 内。
    const cardBlue = hexToRgb(THEMES.card.accents.blue);
    const illuBlue = hexToRgb(THEMES.illustration.accents.blue);
    const FULL_X: [number, number] = [0, cardImg.width - 1];
    const FULL_Y: [number, number] = [0, cardImg.height - 1];
    const THRESHOLD = 20; // 精确色值比对, 只留一点点给编码/取整误差, 不给抗锯齿模糊留空间

    expect(
      regionContainsColor(cardImg, FULL_X, FULL_Y, cardBlue, THRESHOLD),
      'card 主题下应该出现 theme.accents.blue(鲜蓝)',
    ).toBe(true);
    expect(
      regionContainsColor(cardImg, FULL_X, FULL_Y, illuBlue, THRESHOLD),
      'card 主题渲染里不该混入 illustration 的柔和蓝',
    ).toBe(false);
    expect(
      regionContainsColor(illuImg, FULL_X, FULL_Y, illuBlue, THRESHOLD),
      'illustration 主题下应该出现它自己的 theme.accents.blue(柔和蓝, C.lightBlue)',
    ).toBe(true);
    expect(
      regionContainsColor(illuImg, FULL_X, FULL_Y, cardBlue, THRESHOLD),
      'illustration 主题渲染里不该出现全局鲜蓝——这正是复审揪出的 bug',
    ).toBe(false);
  }, 120_000);
});

/*
 * 中性分隔件的对称性(二十九期用户验收时定的约定: 中间那件东西不带方向暗示)。
 *
 * 三十二期给它接了 `drawLine` 动效, 而 `drawLine` 本身是**有方向的**
 * (clipPath 从左边缘向右描画)。两条臂原样套同一个输出, 整条分隔件就会"从左
 * 扫到右", 方向感又回来了 —— Contrast.tsx 把左臂镜像成从右向左, 让两臂从中间
 * 的点对称向外长。
 *
 * 这条约定此前只靠代码注释与人工审查维系, 没有任何测试兜底: 下一个人很容易在
 * 不知情时把左臂改回同向而没有任何东西报警。这条测试把它钉住。
 *
 * 判据: 在描画**进行中**的一帧(draw 起于 t(0.5)、时长 0.5s, 取 40% 处 = 700ms),
 * 只统计中轴附近那条窄带(避开左右两列文字), 断言中轴两侧的非背景像素数接近。
 * 容差 15% 吸收抗锯齿; 同时要求两侧都 > 0 —— 否则"两边都空"也算对称, 是假通过。
 */
describe('中性分隔件不带方向暗示', () => {
  it('描画进行中, 中轴两侧的臂长对称', async () => {
    const png = path.join(os.tmpdir(), `divider-${Date.now()}.png`);
    const ppm = png.replace(/\.png$/, '.ppm');
    try {
      await renderShotStill({
        input: {
          shots: [{
            shotId: 'c1', startMs: 0, endMs: 4000, card: 'contrast' as const,
            slots: { leftLabel: '左', leftText: '甲', rightLabel: '右', rightText: '乙' },
          }] as never,
          audioSrc: null, bgm: null, captions: [],
          sourceVideo: null, aspect: '16:9', visualStyle: 'card',
        },
        shotIndex: 0, atMs: 700, outputPath: png,
      });
      execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
      const img = parsePpm(fs.readFileSync(ppm));
      const cx = Math.floor(img.width / 2);

      /*
       * 扫描中轴附近 ±70px 的竖条(全高的中间 40%)。分隔件与左右两列同处一行、
       * 但那两列的文字在这个 x 范围之外, 所以这条竖条里除了分隔件没有别的东西。
       * 不写死 y: 分隔件的实际纵向位置由 flex 布局决定(实测在 0.45H 附近而非
       * 正中), 写死会扫空。
       *
       * 背景参照取**同一行最左端**的像素而不是 theme.background 常量 ——
       * Ambient 的暗角让背景沿画面呈渐变, 用常量比会把渐变本身当成"非背景"。
       */
      const y0 = Math.floor(img.height * 0.3);
      const y1 = Math.floor(img.height * 0.7);
      const countNonBg = (x0: number, x1: number) => {
        let n = 0;
        for (let y = y0; y <= y1; y += 1) {
          const rowBg = readPixel(img, cx - 70, y);
          for (let x = x0; x <= x1; x += 1) {
            if (manhattan(readPixel(img, x, y), rowBg) > 30) n += 1;
          }
        }
        return n;
      };
      // 排除中心 ±6px 的圆点本身, 只比两条臂
      const left = countNonBg(cx - 69, cx - 7);
      const right = countNonBg(cx + 7, cx + 69);
      expect(left, '左臂在这一帧应已有可见部分').toBeGreaterThan(0);
      expect(right, '右臂在这一帧应已有可见部分').toBeGreaterThan(0);
      const diff = Math.abs(left - right) / Math.max(left, right);
      expect(diff, `左右两臂像素数不对称: left=${left}, right=${right}`).toBeLessThanOrEqual(0.15);

      /*
       * 光比"两臂等长"抓不住方向性 —— 实测过: 把左臂改成与右臂同向描画,
       * 两臂可见长度仍然相等(都是当前进度的百分比), 只是位置从"贴着中心点"
       * 挪到了"远离中心点", 数量判据完全看不出来。
       * 真正要钉住的是**两臂都从中心点向外长**: 所以近中心那一小段必须已经
       * 有像素。同向描画时左臂的可见部分留在远端, 近中心段会是空的。
       */
      const leftNear = countNonBg(cx - 24, cx - 7);
      const rightNear = countNonBg(cx + 7, cx + 24);
      expect(leftNear, '左臂应从中心点向左长(近中心段不该是空的)').toBeGreaterThan(0);
      expect(rightNear, '右臂应从中心点向右长(近中心段不该是空的)').toBeGreaterThan(0);
    } finally {
      [png, ppm].forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    }
  }, 120_000);
});
