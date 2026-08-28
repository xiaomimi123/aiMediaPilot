import { describe, it, expect } from 'vitest';
import {
  computeSceneRects, needsContent, needsPerson, SCENE_LAYOUTS, SCENE_LAYOUT_LABELS, SCENE_LAYOUT_HINTS,
} from '@/lib/video/scene-layout';

const frame = { width: 1080, height: 1920 };

describe('computeSceneRects', () => {
  it('人物全屏: 人占满, 没有内容', () => {
    const r = computeSceneRects(frame, 'person-full');
    expect(r.person).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(r.content).toBeNull();
  });

  it('内容全屏: 内容占满, 人不出现 —— 这就是原来的挖空', () => {
    const r = computeSceneRects(frame, 'content-full');
    expect(r.content).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(r.person).toBeNull();
  });

  it('**左右分屏两块不重叠, 且铺满整幅宽度(含留白)**', () => {
    for (const l of ['content-left', 'content-right'] as const) {
      const r = computeSceneRects(frame, l);
      const a = r.content!;
      const b = r.person!;
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      expect(left.x).toBe(0);
      expect(left.x + left.width).toBeLessThanOrEqual(right.x);
      expect(right.x + right.width).toBe(1080);
    }
  });

  it('左内容和左人物是镜像 —— 内容宽度一样, 只是换边', () => {
    const a = computeSceneRects(frame, 'content-left');
    const b = computeSceneRects(frame, 'content-right');
    expect(a.content!.width).toBe(b.content!.width);
    expect(a.content!.x).toBe(0);
    expect(b.person!.x).toBe(0);
  });

  it('内容比人物宽 —— 分屏的意义是让内容当主角', () => {
    const r = computeSceneRects(frame, 'content-left');
    expect(r.content!.width).toBeGreaterThan(r.person!.width);
  });

  it('圆形人物: 内容铺满, 人是正方形(才能裁成圆)且在画面内', () => {
    const r = computeSceneRects(frame, 'person-circle');
    expect(r.content).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(r.person!.width).toBe(r.person!.height);
    expect(r.personCircle).toBe(true);
    expect(r.person!.x + r.person!.width).toBeLessThanOrEqual(1080);
    expect(r.person!.y + r.person!.height).toBeLessThanOrEqual(1920);
  });

  it('横屏也算得对 —— 不能写死竖屏', () => {
    const r = computeSceneRects({ width: 1920, height: 1080 }, 'content-left');
    expect(r.content!.x + r.content!.width).toBeLessThanOrEqual(1920);
    expect(r.person!.x + r.person!.width).toBe(1920);
  });
});

describe('needsContent / needsPerson', () => {
  it('人物全屏不需要 B-roll —— 可以省掉一次 Builder 调用', () => {
    expect(needsContent('person-full')).toBe(false);
    expect(needsPerson('person-full')).toBe(true);
  });

  it('内容全屏不出现人', () => {
    expect(needsPerson('content-full')).toBe(false);
    expect(needsContent('content-full')).toBe(true);
  });

  it('分屏和圆窗两者都要', () => {
    for (const l of ['content-left', 'content-right', 'person-circle'] as const) {
      expect(needsContent(l)).toBe(true);
      expect(needsPerson(l)).toBe(true);
    }
  });
});

describe('文案完整性', () => {
  it('每个版面都有中文名和一句话说明 —— 五个名字看着都差不多, 没说明等于没给', () => {
    for (const l of SCENE_LAYOUTS) {
      expect(SCENE_LAYOUT_LABELS[l].length).toBeGreaterThan(0);
      expect(SCENE_LAYOUT_HINTS[l].length).toBeGreaterThan(8);
    }
  });
});
