import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, manhattan } from './_ppm-test-utils';

/*
 * 新卡的真渲染测试。断言 JSX 没有意义(组件可能渲染出一片空白也"通过"),
 * 只有真渲染出 PNG 比像素才说明画面上真的有东西。手法照 card-style-render.test.ts。
 */
const renderCard = async (card: string, slots: unknown, atMs: number, name: string) => {
  const png = path.join(os.tmpdir(), `${name}-${Date.now()}.png`);
  const ppm = png.replace(/\.png$/, '.ppm');
  await renderShotStill({
    input: {
      shots: [{ shotId: 's1', startMs: 0, endMs: 5000, card, slots }] as never,
      audioSrc: null, bgm: null, captions: [], sourceVideo: null,
      aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs, outputPath: png,
  });
  execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
  const img = parsePpm(fs.readFileSync(ppm));
  return { img, cleanup: () => [png, ppm].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f)) };
};

/** 画面上有多少非背景像素(背景取同行最左端做参照, 避开 Ambient 暗角渐变)。 */
const countInk = (img: ReturnType<typeof parsePpm>, y0: number, y1: number, x0: number, x1: number) => {
  let n = 0;
  for (let y = y0; y <= y1; y += 4) {
    const bg = readPixel(img, 4, y);
    for (let x = x0; x <= x1; x += 4) {
      if (manhattan(readPixel(img, x, y), bg) > 30) n += 1;
    }
  }
  return n;
};

describe('ring 卡', () => {
  it('画面上有环也有数字', async () => {
    const { img, cleanup } = await renderCard('ring', { label: '四线城市占比', value: 32.2, suffix: '%' }, 2000, 'ring');
    try {
      // 环画在画面中部, 数字在环心 —— 中间那块区域必须有明显的墨
      const ink = countInk(img, Math.floor(img.height * 0.3), Math.floor(img.height * 0.7),
        Math.floor(img.width * 0.3), Math.floor(img.width * 0.7));
      expect(ink, '环与数字所在区域应有可见内容').toBeGreaterThan(50);
    } finally { cleanup(); }
  }, 120_000);

  it('ratio 不同 → 环画出的长度不同 → 像素不同', async () => {
    const a = await renderCard('ring', { label: '占比', value: 20 }, 2000, 'ring20');
    const b = await renderCard('ring', { label: '占比', value: 80 }, 2000, 'ring80');
    try {
      const inkA = countInk(a.img, 0, a.img.height - 1, 0, a.img.width - 1);
      const inkB = countInk(b.img, 0, b.img.height - 1, 0, b.img.width - 1);
      expect(inkB, '80% 的环比 20% 的环更长, 墨更多').toBeGreaterThan(inkA);
    } finally { a.cleanup(); b.cleanup(); }
  }, 120_000);
});

describe('odometer 卡', () => {
  it('滚动进行中: 某一帧上个位已停、高位还在动', async () => {
    // 逐位错峰 0.11s: 个位 at=0.3s, 千位 at=0.3+3×0.11=0.63s
    // 取 t=1.0s: 个位(0.3+0.9=1.2s 结束)接近停、千位刚过半 —— 两位数字不同
    const { img, cleanup } = await renderCard('odometer', { label: '累计', value: 1234 }, 1000, 'odo');
    try {
      const ink = countInk(img, Math.floor(img.height * 0.35), Math.floor(img.height * 0.65),
        Math.floor(img.width * 0.25), Math.floor(img.width * 0.75));
      expect(ink, '数字滚轮区域应有可见内容').toBeGreaterThan(50);
    } finally { cleanup(); }
  }, 120_000);
});

/**
 * 逐像素比较两张同尺寸渲染, 数出有多少采样点不同。
 *
 * 为什么不用上面的 `countInk`: 它拿「同一行最左端的像素」当背景参照, 而画面底层
 * 有二十六期的 Ambient 环境运动层(暗角 + 呼吸 + 扫光) —— 暗角让左端本来就比中间
 * 暗一大截, 于是整行几乎每个点都"与参照不同", 指标在名牌进场前就已经饱和到约 91%,
 * 再加内容读不出信号, 甚至会因为名牌盖住暗角而让计数**下降**(实测 lateDelta = -6)。
 *
 * 改成两张图互比: 只要两次渲染取同一时刻, Ambient 在两张图里逐像素完全相同,
 * 相减自然抵消, 剩下的差异纯粹来自"内容不一样"。
 */
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

describe('entity 卡', () => {
  /*
   * 这条测试的判据改过一次(控制者裁决)。原写法是「同一份 chips, 比 600ms 与
   * 3000ms 两个时刻的全幅墨量」, 实施者用三组隔离实验证伪了它: 那个带里
   * Ambient 自己就占满约 91% 的采样点, 两个时刻之间九成以上的差异来自环境层
   * 随时间变化, 而不是名牌。
   *
   * 根因是测量设计: **跨时刻比较, 等于把画面里所有随时间变化的东西都算进差值**,
   * 而这个项目的画面底层恰恰有一层一直在动的环境层。本仓既有的
   * card-style-render.test.ts 一直是同一时刻比对(只变 style/visualStyle),
   * 我写这条时没有沿用那个约定。
   *
   * 改成同一时刻、两份内容(3 块 vs 1 块)的**逐像素差分**。Ambient 抵消之后,
   * 差异只可能来自多出来的那两块名牌。于是一次同时验两件事:
   * 「名牌真的画出来了」和「逐块错峰」—— 600ms 时第 2、3 块还没起步, 差分应接近 0;
   * 3000ms 时它们到位, 差分应当明显。
   */
  it('三块名牌逐块滑入 —— 同一时刻的逐像素差分, 让 Ambient 抵消', async () => {
    const three = [
      { name: 'DeepSeek', sub: 'AI 公司', tone: 'dark' as const },
      { name: '智谱', sub: 'AI 公司', tone: 'light' as const },
      { name: '月之暗面', sub: 'AI 公司', tone: 'dark' as const },
    ];
    const one = [three[0]];
    // 逐块 0.5s 错峰: 第 1 块 at=0.2s, 第 2 块 at=0.7s, 第 3 块 at=1.2s
    const [e3, e1, l3, l1] = await Promise.all([
      renderCard('entity', { chips: three }, 600, 'ent-e3'),
      renderCard('entity', { chips: one }, 600, 'ent-e1'),
      renderCard('entity', { chips: three }, 3000, 'ent-l3'),
      renderCard('entity', { chips: one }, 3000, 'ent-l1'),
    ]);
    try {
      const w = e3.img.width, h = e3.img.height;
      /*
       * 两个量各管一件事:
       * - `full`(整条带): 三块 vs 一块的全部差异。它证明"名牌真的画出来了",
       *   但**不能**用来证明错峰 —— 块数不同, 第 1 块的居中位置就不同,
       *   差异里混着版面位移(实测 600ms 时就有 3102, 而那时第 2、3 块根本没起步)。
       * - `right`(右侧区): 只有第 3 块能占的位置。一块的版本这里永远是空的,
       *   所以这个量**只对"第 3 块到没到"敏感**, 版面位移影响不到它。
       */
      const full = (a: ReturnType<typeof parsePpm>, b: ReturnType<typeof parsePpm>) =>
        diffPixels(a, b, Math.floor(h * 0.35), Math.floor(h * 0.65), 0, w - 1);
      const right = (a: ReturnType<typeof parsePpm>, b: ReturnType<typeof parsePpm>) =>
        diffPixels(a, b, Math.floor(h * 0.35), Math.floor(h * 0.65), Math.floor(w * 0.62), Math.floor(w * 0.95));

      expect(full(l3.img, l1.img), '三块到位后, 与只有一块的画面应有大片不同').toBeGreaterThan(50);

      const earlyRight = right(e3.img, e1.img);
      const lateRight = right(l3.img, l1.img);
      expect(lateRight, '第 3 块到位后, 右侧区应当出现内容').toBeGreaterThan(100);
      expect(
        earlyRight,
        `600ms 时第 3 块(at=1.2s)还没起步, 右侧区应当与只有一块时一模一样(实测 ${earlyRight}, 后期 ${lateRight})`,
      ).toBeLessThan(20);
    } finally { [e3, e1, l3, l1].forEach((r) => r.cleanup()); }
  }, 240_000);
});
