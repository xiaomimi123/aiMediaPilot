import { describe, expect, it } from 'vitest';
import { checkOrientation } from '@/lib/film/check';
import { checkShots, checkNumbers, numberTokens, toChineseNumber, checkFilmSource } from '@/lib/film/check';
import type { ShotsFile } from '@/lib/film/shots';

const data = {
  durationSec: 20,
  captions: [{ text: '半年后干到类目第一' }],
  materials: [
    { id: 'img', file: 'm-img.png', mediaType: 'image' as const, durationSec: null },
    { id: 'rec', file: 'm-rec.mov', mediaType: 'video' as const, durationSec: 30 },
  ],
};
const files = new Set(['raw.mov', 'm-img.png', 'm-rec.mov']);
const shots = (list: ShotsFile['shots']): ShotsFile => ({ version: 1, shots: list });

describe('checkShots', () => {
  it('passes a contiguous plan covering the whole recording', () => {
    expect(checkShots(shots([
      { id: 'a', fromSec: 0, toSec: 8, intent: '' },
      { id: 'b', fromSec: 8, toSec: 20, intent: '', material: { id: 'rec', clipFromSec: 5, clipToSec: 20, speed: 1.5 } },
    ]), data, files)).toEqual([]);
  });
  it('reports gaps, overlaps, uncovered tail and bad shot lengths with actual values', () => {
    const issues = checkShots(shots([
      { id: 'a', fromSec: 0.5, toSec: 6, intent: '' },
      { id: 'b', fromSec: 7, toSec: 7.5, intent: '' },
      { id: 'c', fromSec: 7.2, toSec: 19.5, intent: '' },
    ]), data, files);
    expect(issues).toContain('第一个镜头要从 0 秒开始，现在是 0.5 秒');
    expect(issues).toContain('镜头 a 与 b 之间空了 1 秒（6 → 7）');
    expect(issues).toContain('镜头 b 与 c 重叠了 0.3 秒（7.5 → 7.2）');
    expect(issues).toContain('镜头 b 只有 0.5 秒，最短 1 秒');
    expect(issues).toContain('镜头 c 超过 12 秒（12.3 秒）');
    expect(issues).toContain('最后一个镜头到 19.5 秒结束，口播有 20 秒');
  });
  it('reports a missing material file', () => {
    const issues = checkShots(shots([
      { id: 'a', fromSec: 0, toSec: 10, intent: '', material: { id: 'img' } },
      { id: 'b', fromSec: 10, toSec: 20, intent: '' },
    ]), data, new Set(['raw.mov']));
    expect(issues).toEqual(['镜头 a 用的素材文件不存在：m-img.png']);
  });
  it('reports unknown materials, clips outside the source, speed above 2x and clips that do not fit', () => {
    const issues = checkShots(shots([
      { id: 'a', fromSec: 0, toSec: 5, intent: '', material: { id: 'nope' } },
      { id: 'b', fromSec: 5, toSec: 10, intent: '', material: { id: 'rec', clipFromSec: 25, clipToSec: 35 } },
      { id: 'c', fromSec: 10, toSec: 15, intent: '', material: { id: 'rec', clipFromSec: 0, clipToSec: 12, speed: 2.5 } },
      { id: 'd', fromSec: 15, toSec: 20, intent: '', material: { id: 'rec', clipFromSec: 0, clipToSec: 20, speed: 2 } },
    ]), data, files);
    expect(issues).toContain('镜头 a 引用了不存在的素材 nope');
    expect(issues).toContain('镜头 b 截取到 35 秒，素材只有 30 秒');
    expect(issues).toContain('镜头 c 加速 2.5 倍，最多 2 倍');
    expect(issues).toContain('镜头 d 截取 20 秒 ÷ 2 倍 = 10 秒，放不进 5 秒的镜头');
  });
});

describe('numbers', () => {
  it('extracts number tokens, normalising thousands separators and percent', () => {
    expect(numberTokens('卖了 6,000 单，复购 32.5%，Top1')).toEqual(['6000', '32.5', '1']);
  });
  it('converts simple numbers to Chinese', () => {
    expect(toChineseNumber(50)).toBe('五十');
    expect(toChineseNumber(6000)).toBe('六千');
    expect(toChineseNumber(15)).toBe('十五');
    expect(toChineseNumber(305)).toBe('三百零五');
  });
  it('accepts numbers that appear in Chinese form', () => {
    expect(checkNumbers("export const COPY = { a: '50+ 岁的老板', b: '6000 单' }", ['买它的人有五十多岁', '卖了六千多单'])).toEqual([]);
  });
  it('flags a number that appears nowhere in the script or transcript', () => {
    expect(checkNumbers("export const COPY = { a: '转化率提升 300%' }", ['半年后干到类目第一'])).toEqual([
      '画面数字 300 在稿子和转写里都找不到（可能是编造的）',
    ]);
  });
});

describe('numbers: stricter matching', () => {
  it('does not accept a digit just because it appears inside a bigger Chinese number', () => {
    expect(checkNumbers("export const COPY = { a: '效率提升 5 倍' }", ['我做到了五十单'])).toEqual(['画面数字 5 在稿子和转写里都找不到（可能是编造的）']);
    expect(checkNumbers("export const COPY = { a: '500 单' }", ['营收五百万'])).toEqual(['画面数字 500 在稿子和转写里都找不到（可能是编造的）']);
  });
  it('accepts 两 as a form of 2', () => {
    expect(checkNumbers("export const COPY = { a: '2000 单' }", ['卖了两千单'])).toEqual([]);
  });
  it('checks numbers written in Chinese on screen too', () => {
    expect(checkNumbers("export const COPY = { a: '月入三万' }", ['半年后干到类目第一'])).toEqual(['画面数字 三万 在稿子和转写里都找不到（可能是编造的）']);
    expect(checkNumbers("export const COPY = { a: '五十多岁' }", ['买它的人有五十多岁'])).toEqual([]);
  });
  it('only reads string contents, not keys or identifiers', () => {
    expect(checkNumbers("export const COPY = { line7: '没有数字' }", ['x'])).toEqual([]);
  });
});

describe('checkFilmSource', () => {
  const shots = { version: 1 as const, shots: [{ id: 'hook', fromSec: 0, toSec: 5, intent: '' }, { id: 'end', fromSec: 5, toSec: 9, intent: '' }] };
  it('passes when all text comes from COPY and all shots use shots.json timing', () => {
    const src = `// 注释里的中文不算
      <Shot {...at.hook}><Big>{COPY.a}</Big></Shot>
      <Shot {...at.end}><Note>{COPY.b}</Note></Shot>`;
    expect(checkFilmSource(src, shots)).toEqual([]);
  });
  it('flags literal Chinese text and literal numbers in Film.tsx', () => {
    const src = `<Shot {...at.hook}><Big>月入三万</Big></Shot><Shot {...at.end}><Big>{'提升'}</Big><div>300</div></Shot>`;
    const issues = checkFilmSource(src, shots);
    expect(issues).toContain('Film.tsx 里有画面文字，要写进 copy.ts：月入三万');
    expect(issues).toContain('Film.tsx 里有画面文字，要写进 copy.ts：提升');
    expect(issues).toContain('Film.tsx 里有画面数字，要写进 copy.ts：300');
  });
  it('flags hand-written shot timings and shots that are never used', () => {
    const src = `<Shot from={0} to={5}><Big>{COPY.a}</Big></Shot>`;
    const issues = checkFilmSource(src, shots);
    expect(issues).toContain('Shot 的时间要用 shots.json（写成 <Shot {...at.镜头id}>），不要手写秒数');
    expect(issues).toContain('镜头 hook 在 Film.tsx 里没有用到');
    expect(issues).toContain('镜头 end 在 Film.tsx 里没有用到');
  });
});


describe('checkOrientation', () => {
  const LAND_INDEX = '<OrientationProvider value="landscape">';
  it('treats a film without orientation as portrait', () => {
    expect(checkOrientation({}, 'width={W} height={H}')).toEqual({ orientation: 'portrait', issues: [] });
  });
  it('accepts a landscape film with its provider', () => {
    expect(checkOrientation({ orientation: 'landscape' }, LAND_INDEX, 'landscape')).toEqual({ orientation: 'landscape', issues: [] });
  });
  it('fails a landscape film whose index.tsx lost the provider', () => {
    expect(checkOrientation({ orientation: 'landscape' }, 'width={W} height={H}').issues).toEqual(['横版片子的 index.tsx 被改动了（缺少 OrientationProvider）：不要改 index.tsx，用 film new --landscape 重建']);
  });
  it('fails an unknown orientation value', () => {
    expect(checkOrientation({ orientation: 'wide' }, '').issues).toEqual(['data.json 里的版式不认识：wide（只能是 portrait 或 landscape）']);
  });
  it('fails when the film does not match the expected orientation', () => {
    expect(checkOrientation({}, '', 'landscape').issues).toEqual(['要横版，但这个片子目录是竖版：用 film new --landscape 重建']);
    expect(checkOrientation({ orientation: 'landscape' }, LAND_INDEX, 'portrait').issues).toEqual(['要竖版，但这个片子目录是横版：用 film new 重建']);
  });
  it('rejects an unknown --expect value', () => {
    expect(checkOrientation({}, '', 'horizontal').issues).toEqual(['--expect 只能是 landscape 或 portrait']);
    expect(checkOrientation({}, '', true).issues).toEqual(['--expect 只能是 landscape 或 portrait']);
  });
});
