import { describe, it, expect } from 'vitest';
import { safeBandFor, parseFaceReport } from '@/lib/video/face-safe-zone';

const F = { width: 1080, height: 1920 };
/** 脸稳定在画面中部。 */
const steady = [
  { t: 0, face: [270, 600, 540, 600] as [number, number, number, number] },
  { t: 2, face: [280, 610, 530, 590] as [number, number, number, number] },
  { t: 4, face: [275, 605, 535, 595] as [number, number, number, number] },
];

describe('safeBandFor —— 按时间窗口算, 不是全片一个静态区', () => {
  it('脸在中部时, 上方给出一条可用带', () => {
    const b = safeBandFor(steady, 0, 4000, F);
    expect(b.top).not.toBeNull();
    expect(b.top!.height).toBeGreaterThan(100);
    expect(b.top!.y).toBe(0);
  });

  it('窗口外的采样点不参与 —— 这正是「按时间段」的意义', () => {
    const withLate = [...steady, { t: 100, face: [0, 0, 1080, 1900] as [number, number, number, number] }];
    const b = safeBandFor(withLate, 0, 4000, F);
    // 那个占满全屏的框在 100s, 不该污染 0~4s 的判断
    expect(b.top).not.toBeNull();
  });

  it('窗口内脸占满画面时, 老实说没有安全带', () => {
    const full = [{ t: 1, face: [0, 0, 1080, 1920] as [number, number, number, number] }];
    const b = safeBandFor(full, 0, 2000, F);
    expect(b.top).toBeNull();
    expect(b.bottom).toBeNull();
  });

  it('窗口里一个采样点都没有时返回 null, 由调用方退回手填', () => {
    expect(safeBandFor(steady, 50_000, 60_000, F).top).toBeNull();
  });
});

describe('parseFaceReport', () => {
  it('检出率低时判为不可信 —— 偏小的安全区比没有更危险', () => {
    const r = parseFaceReport(JSON.stringify({ detect_rate: 0.2, reliable: false, samples: [] }));
    expect(r?.reliable).toBe(false);
  });

  it('坏 JSON 返回 null, 不抛', () => {
    expect(parseFaceReport('{ not json')).toBeNull();
  });
});
