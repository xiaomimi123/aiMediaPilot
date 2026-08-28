import { describe, it, expect } from 'vitest';
import {
  totalMs, sceneAt, msToPx, pxToMs, formatTimecode, buildTrack, type TimelineScene,
} from '@/lib/video/timeline';

const scenes: TimelineScene[] = [
  { id: 'a', startMs: 0, endMs: 5000, label: '一' },
  { id: 'b', startMs: 5000, endMs: 12000, label: '二' },
  { id: 'c', startMs: 12000, endMs: 15000, label: '三' },
];

describe('totalMs', () => {
  it('取最后一个场景的结束', () => expect(totalMs(scenes)).toBe(15000));
  it('空的时候是 0 不是 NaN', () => expect(totalMs([])).toBe(0));
});

describe('sceneAt', () => {
  it('**边界左闭右开** —— 两个都命中会让预览在边界处来回跳', () => {
    expect(sceneAt(scenes, 5000)!.scene.id).toBe('b');
    expect(sceneAt(scenes, 4999)!.scene.id).toBe('a');
  });

  it('给出场景内偏移 —— 预览就 seek 到这里', () => {
    expect(sceneAt(scenes, 7500)!.offsetMs).toBe(2500);
  });

  it('拖到最右端仍然选中最后一个场景, 而不是什么都不选', () => {
    const hit = sceneAt(scenes, 15000)!;
    expect(hit.scene.id).toBe('c');
    expect(hit.offsetMs).toBe(3000);
  });

  it('落在场景之间的空隙时归给前一个 —— null 会让预览整块消失', () => {
    const gapped: TimelineScene[] = [
      { id: 'a', startMs: 0, endMs: 1000, label: 'a' },
      { id: 'b', startMs: 3000, endMs: 4000, label: 'b' },
    ];
    expect(sceneAt(gapped, 2000)!.scene.id).toBe('a');
  });

  it('时间为负或场景乱序都不崩', () => {
    expect(sceneAt(scenes, -100)!.scene.id).toBe('a');
    expect(sceneAt([...scenes].reverse(), 7500)!.scene.id).toBe('b');
  });

  it('没有场景时返回 null', () => expect(sceneAt([], 0)).toBeNull());
});

describe('px ↔ ms', () => {
  it('来回换算一致', () => {
    expect(pxToMs(msToPx(7500, 15000, 600), 15000, 600)).toBe(7500);
  });

  it('**拖出容器要夹住** —— 负数或超长会让预览 seek 到不存在的位置然后静止', () => {
    expect(pxToMs(-200, 15000, 600)).toBe(0);
    expect(pxToMs(9999, 15000, 600)).toBe(15000);
  });

  it('宽度或总长为 0 时不除零', () => {
    expect(pxToMs(100, 0, 600)).toBe(0);
    expect(pxToMs(100, 15000, 0)).toBe(0);
    expect(msToPx(100, 0, 600)).toBe(0);
  });
});

describe('formatTimecode', () => {
  it('读到十分之一秒 —— 整秒在编辑台上不够用', () => {
    expect(formatTimecode(66300)).toBe('1:06.3');
    expect(formatTimecode(0)).toBe('0:00.0');
  });
  it('负数按 0 显示', () => expect(formatTimecode(-5)).toBe('0:00.0'));
});

describe('buildTrack', () => {
  it('按比例排布', () => {
    const t = buildTrack(scenes, 15000);
    expect(t[1].leftPct).toBeCloseTo(33.33, 1);
  });

  it('**极短的块给最小宽度** —— 点不中的块等于不存在', () => {
    const tiny = buildTrack([{ id: 'x', startMs: 0, endMs: 300, label: 'x' }], 120000);
    expect(tiny[0].widthPct).toBeGreaterThanOrEqual(1.2);
  });

  it('总长为 0 时返回空数组', () => expect(buildTrack(scenes, 0)).toEqual([]));
});

import { parseSrtCues } from '@/lib/video/timeline';

describe('parseSrtCues', () => {
  const srt = `1
00:00:00,000 --> 00:00:02,400
我卡在第三步

2
00:00:02,400 --> 00:00:05,000
每一步都报新的错
`;

  it('解析出时间和文字', () => {
    const cues = parseSrtCues(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 0, endMs: 2400, text: '我卡在第三步' });
    expect(cues[1].startMs).toBe(2400);
  });

  it('多行文字合成一行 —— 时间线上的块只有一行高', () => {
    const cues = parseSrtCues('1\n00:00:00,000 --> 00:00:01,000\n上\n下\n');
    expect(cues[0].text).toBe('上 下');
  });

  it('**畸形块跳过而不是抛** —— 一条坏字幕不该让整条时间线消失', () => {
    expect(parseSrtCues('乱七八糟\n\n1\n00:00:00,000 --> 00:00:01,000\n好的\n')).toHaveLength(1);
    expect(parseSrtCues('1\n不是时间行\n文字\n')).toEqual([]);
  });

  it('空串和空白返回空数组', () => {
    expect(parseSrtCues('')).toEqual([]);
    expect(parseSrtCues('\n\n\n')).toEqual([]);
  });

  it('没有文字的块不要 —— 空块在轨道上是个点不中的窄条', () => {
    expect(parseSrtCues('1\n00:00:00,000 --> 00:00:01,000\n')).toEqual([]);
  });
});
