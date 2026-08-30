import { computeSceneRects, type SceneLayout } from './scene-layout';

/**
 * 文字安全区(二十三期)。
 *
 * 第一版把安全区写死成「画面左半边」, 理由是参考片的人站在右边。那是把**一条片子的
 * 拍摄习惯**当成了系统的前提 —— 用户可以拍 16:9 也可以拍 9:16, 人可以在左、在右、
 * 在中间, 排版必须跟着变。
 *
 * 所以安全区从三件事算出来, 不写死:
 * 1. **画幅** —— 横屏的空位在左右, 竖屏的空位在上下(人脸通常占中间)
 * 2. **版面** —— 分屏时内容那一半就是安全区; 圆窗时几乎整幅都是
 * 3. **人在哪边** —— 人物全屏时的兜底信息来源。
 *
 * **上面第 3 条原来写的是「这个由人设定, 不假装能自动识别: 真做人像分割要 matting,
 * 是另一个量级的工程」。那句话错了, 留在这里当记录。** 错在把「避开人脸」当成了
 * 「分割人像」—— 避开人脸只需要人脸 bbox, YuNet 模型 230KB、纯 CPU、每帧几毫秒。
 * 代价被高估了一个量级, 于是这件本该量出来的事被交给了手填, 而手填会填错。
 *
 * 实测版本见 `scripts/face_bbox.py` + `face-safe-zone.ts`: 按**时间窗口**给安全带
 * (静态安全区在真实素材上不成立 —— 人一直在动, 全片并集覆盖 95% 画面)。手填的
 * personSide 保留为兜底: 检出率不够或拿不到素材时仍然要有个说法。
 */

export const PERSON_SIDES = ['left', 'center', 'right'] as const;
export type PersonSide = (typeof PERSON_SIDES)[number];

export const PERSON_SIDE_LABELS: Record<PersonSide, string> = {
  left: '人在左',
  center: '人在中间',
  right: '人在右',
};

export interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 竖屏时人脸大致占的纵向区间 —— 上方留给大字, 下方留给字幕。 */
const PORTRAIT_FACE_TOP = 0.34;

/**
 * 算出这一幕的文字安全区。
 *
 * **人物全屏 + 竖屏**时安全区是**上方一条带**, 不是左半边: 竖屏里人脸占中间,
 * 左右两侧都贴着脸。参考片是 16:9 才有左半边可用。
 */
export function textSafeZone(
  frame: { width: number; height: number },
  layout: SceneLayout,
  personSide: PersonSide,
): Zone {
  const W = frame.width;
  const H = frame.height;
  const portrait = H > W;
  const rects = computeSceneRects(frame, layout);

  // 内容全屏: 没有人, 整幅都能放
  if (!rects.person) return { x: 0, y: 0, width: W, height: H };

  // 圆窗要**排在分屏之前**判: 圆窗的 content 也是整幅, 会被下面那条分屏判据
  // 先截走, 于是安全区变成整幅 —— 字直接盖在圆窗上。
  if (rects.personCircle) {
    // 人只占一个角(右下), 取上方 62% 避开它
    return { x: 0, y: 0, width: W, height: Math.round(H * 0.62) };
  }

  // 分屏: 内容那一半就是安全区 —— 它本来就是给内容留的
  if (rects.content && rects.person.width < W) {
    return rects.content;
  }

  // 人物全屏 —— 只能靠 personSide 和画幅
  if (portrait) {
    // 竖屏: 人脸占中间, 上方是唯一可靠的空位
    return { x: 0, y: 0, width: W, height: Math.round(H * PORTRAIT_FACE_TOP) };
  }
  if (personSide === 'center') {
    // 横屏但人在中间: 左右都贴脸, 退回上方一条带
    return { x: 0, y: 0, width: W, height: Math.round(H * 0.3) };
  }
  // 横屏且人偏一侧: 另一半整个是安全区
  const half = Math.round(W * 0.48);
  return personSide === 'right'
    ? { x: 0, y: 0, width: half, height: H }
    : { x: W - half, y: 0, width: half, height: H };
}

export interface SlotPoint {
  x: number;
  y: number;
  /** ASS 对齐锚点。 */
  an: number;
}

/**
 * 在安全区内排 N 个槽位。
 *
 * **竖排还是横排由安全区的形状决定**: 高瘦的区(横屏的半边)竖排, 扁宽的区
 * (竖屏的上方带)也竖排但行距小 —— 两种都竖排是因为「关键词 ↓ 关键词」这个
 * 推导形态是这个风格的骨架, 横着排就不成立了。
 *
 * 扁宽区放不下 5 行时**自动减行**而不是压字号: 字压小了在手机上就读不出来,
 * 而少两行只是少两个词。
 */
export function slotsInZone(zone: Zone, count: number): SlotPoint[] {
  const n = Math.max(1, count);
  const padX = Math.round(zone.width * 0.08);
  const x = zone.x + padX;

  // 行距至少要放得下一行大字(按安全区高度的 1/6 估), 放不下就减行
  const minRow = Math.round(zone.height / 6);
  const usable = Math.round(zone.height * 0.82);
  const rows = Math.max(1, Math.min(n, Math.floor(usable / Math.max(1, minRow))));

  const top = zone.y + Math.round(zone.height * 0.12);
  const step = rows > 1 ? Math.round((usable - (usable - zone.height * 0.76)) / (rows - 1)) : 0;

  return Array.from({ length: rows }, (_, i) => ({
    x,
    y: top + step * i,
    an: 4, // 左中对齐: 竖向堆叠成图解时左对齐才像一列
  }));
}

/** 安全区能排下几行 —— 出计划前告诉模型, 免得它给出放不下的行数。 */
export function slotCapacity(zone: Zone): number {
  return slotsInZone(zone, 5).length;
}
