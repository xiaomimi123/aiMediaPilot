import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, manhattan } from './_ppm-test-utils';

/*
 * curve / rank 两张卡的真渲染测试。
 *
 * 判据说明(控制者预先裁决, 见 task-4-brief.md 派发说明第 6 条): 计划书原始草稿
 * 里那两条测试用的是「同一份内容, 比不同时刻的墨量」——这个判据在本项目里已经
 * 证伪过一次(entity 卡, 见 cards-ring-odometer-entity.test.ts 的大段注释):
 * 画面底层有二十六期的 Ambient 环境运动层(暗角+呼吸+扫光)一直在动, 跨时刻比较
 * 会把 Ambient 自己随时间的变化也算进差值, 实测它能占满约 91% 的采样点,
 * 内容信号被淹没。
 *
 * 这里改用「同一时刻、两份内容」的逐像素差分(diffPixels, 从 entity 那条测试
 * 复制过来——两个测试文件各自留一份私有辅助是本期的既定安排, 不抽公共模块):
 * 同一时刻的两次渲染, Ambient 逐像素完全相同, 相减自然抵消, 剩下的纯粹是
 * 内容差异。
 *
 * 另一个坑(同样在 entity 那条测试踩过并写进了注释): 换内容的份数会改变版面
 * (行数/点数不同, 第一项的居中位置就不同)。所以两份对照数据必须**行数/点数
 * 相同**——这样版面完全一致, 差分只可能来自"数值本身"(条长/曲线形状)。
 */

const renderCard = async (card: string, slots: unknown, atMs: number, name: string) => {
  const png = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  const ppm = png.replace(/\.png$/, '.ppm');
  await renderShotStill({
    input: {
      shots: [{ shotId: 's1', startMs: 0, endMs: 8000, card, slots }] as never,
      audioSrc: null, bgm: null, captions: [], sourceVideo: null,
      aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs, outputPath: png,
  });
  execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
  const img = parsePpm(fs.readFileSync(ppm));
  return { img, cleanup: () => [png, ppm].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f)) };
};

/** 逐像素比较两张同尺寸渲染, 数出有多少采样点不同(手法与出处见文件头注释)。 */
const diffPixels = (
  a: ReturnType<typeof parsePpm>, b: ReturnType<typeof parsePpm>,
  y0: number, y1: number, x0: number, x1: number,
) => {
  let n = 0;
  for (let y = y0; y <= y1; y += 4) {
    for (let x = x0; x <= x1; x += 4) {
      if (manhattan(readPixel(a, x, y), readPixel(b, x, y)) > 30) n += 1;
    }
  }
  return n;
};

describe('curve 卡', () => {
  // A: 任务书给的递增五点。B: 同样五个 at 标签、点数相同(版面因此完全一致),
  // 但 value 全等——一条平线。差异只可能来自"曲线怎么画"(y 位置/形状/峰值)。
  const POINTS_UP = [
    { at: '1月', value: 100 }, { at: '2月', value: 180 }, { at: '3月', value: 340 },
    { at: '4月', value: 520 }, { at: '5月', value: 900 },
  ];
  const POINTS_FLAT = POINTS_UP.map((p) => ({ at: p.at, value: 300 }));

  it('描画早期(还没画到)两份内容几乎一样, 画完之后应有明显不同', async () => {
    const [early1, early2, late1, late2] = await Promise.all([
      renderCard('curve', { label: '搜索量', points: POINTS_UP, suffix: '万' }, 200, 'curve-up-early'),
      renderCard('curve', { label: '搜索量', points: POINTS_FLAT, suffix: '万' }, 200, 'curve-flat-early'),
      renderCard('curve', { label: '搜索量', points: POINTS_UP, suffix: '万' }, 6000, 'curve-up-late'),
      renderCard('curve', { label: '搜索量', points: POINTS_FLAT, suffix: '万' }, 6000, 'curve-flat-late'),
    ]);
    try {
      const w = early1.img.width, h = early1.img.height;
      // 图表主体所在的竖向条带——避开顶部 label/peak 那一行以外的区域没有意义,
      // 干脆直接比整块内容区(横向也是全宽, 因为点是横向铺满的)。
      const band = (a: ReturnType<typeof parsePpm>, b: ReturnType<typeof parsePpm>) =>
        diffPixels(a, b, Math.floor(h * 0.15), Math.floor(h * 0.85), 0, w - 1);

      const earlyDiff = band(early1.img, early2.img);
      const lateDiff = band(late1.img, late2.img);

      expect(earlyDiff, `描画早期(200ms)两条曲线都还没画出来, 差分应很小(实测 ${earlyDiff})`).toBeLessThan(20);
      expect(
        lateDiff,
        `画完之后(6000ms)递增曲线与平线形状/峰值都不同, 差分应明显大于早期(早期 ${earlyDiff}, 晚期 ${lateDiff})`,
      ).toBeGreaterThan(200);
    } finally { [early1, early2, late1, late2].forEach((r) => r.cleanup()); }
  }, 240_000);
});

describe('rank 卡', () => {
  // A: 任务书给的四行(值递减)。B: 同样四行名字、行数相同(版面因此完全一致),
  // 但 value 全填 1——四条等长。差异只可能来自"条形长了多少/数字滚到多少"。
  const ROWS_VARIED = [
    { name: '四线城市', value: 32 }, { name: '三线城市', value: 27 },
    { name: '二线城市', value: 21 }, { name: '一线城市', value: 20 },
  ];
  const ROWS_FLAT = ROWS_VARIED.map((r) => ({ name: r.name, value: 1 }));

  it('条形生长早期两份内容几乎一样, 长完之后应有明显不同', async () => {
    // 早期取 250ms——严格早于第一行的起播时刻(spec: firstRowAtSec = t(0.3) = 300ms)。
    // 挑"动效还没开始"而不是"动效刚开始一点点": barGrow/countTo 在起播前
    // 无条件夹在 0(不管目标值是 32 还是 1), 两份数据在这一刻的渲染理应逐像素
    // 相同——这比"早期应该很小"更强的一条断言, 也顺带验证了动效起播时刻本身没错。
    const [early1, early2, late1, late2] = await Promise.all([
      renderCard('rank', { title: '需求分布', rows: ROWS_VARIED, suffix: '%' }, 250, 'rank-varied-early'),
      renderCard('rank', { title: '需求分布', rows: ROWS_FLAT, suffix: '%' }, 250, 'rank-flat-early'),
      renderCard('rank', { title: '需求分布', rows: ROWS_VARIED, suffix: '%' }, 4000, 'rank-varied-late'),
      renderCard('rank', { title: '需求分布', rows: ROWS_FLAT, suffix: '%' }, 4000, 'rank-flat-late'),
    ]);
    try {
      const w = early1.img.width, h = early1.img.height;
      const band = (a: ReturnType<typeof parsePpm>, b: ReturnType<typeof parsePpm>) =>
        diffPixels(a, b, Math.floor(h * 0.25), Math.floor(h * 0.85), 0, w - 1);

      const earlyDiff = band(early1.img, early2.img);
      const lateDiff = band(late1.img, late2.img);

      expect(earlyDiff, `250ms(早于第一行起播时刻 300ms)两份数据的条形/数字都还夹在 0, 差分应几乎为 0(实测 ${earlyDiff})`).toBeLessThan(5);
      expect(
        lateDiff,
        `条形长完(4000ms)后两份数据的条长/数字都明显不同(早期 ${earlyDiff}, 晚期 ${lateDiff})`,
      ).toBeGreaterThan(200);
    } finally { [early1, early2, late1, late2].forEach((r) => r.cleanup()); }
  }, 240_000);

  it('最高值那行与其它行的颜色不同(实测色值断言)', async () => {
    const { img, cleanup } = await renderCard('rank', { title: '需求分布', rows: ROWS_VARIED, suffix: '%' }, 4000, 'rank-color');
    try {
      // 扫每一行"名字之后、条形所在竖直位置"上出现的最浓像素色值(与该行左侧
      // 背景的差最大的点)——同一行内条形颜色是常量色块, 扫描窗口内必然采样到它。
      const rowInkColor = (idx: number): [number, number, number] => {
        const y = Math.floor(img.height * (0.35 + idx * 0.1));
        const bg = readPixel(img, 4, y);
        let best: [number, number, number] = bg;
        let bestDiff = 0;
        for (let x = Math.floor(img.width * 0.15); x < Math.floor(img.width * 0.9); x += 2) {
          const px = readPixel(img, x, y);
          const d = manhattan(px, bg);
          if (d > bestDiff) { bestDiff = d; best = px; }
        }
        return best;
      };
      const topColor = rowInkColor(0);
      const bottomColor = rowInkColor(3);
      expect(
        manhattan(topColor, bottomColor),
        `最高值那行(实测色值 ${JSON.stringify(topColor)})应与末行(实测色值 ${JSON.stringify(bottomColor)})颜色明显不同`,
      ).toBeGreaterThan(30);
    } finally { cleanup(); }
  }, 120_000);
});
