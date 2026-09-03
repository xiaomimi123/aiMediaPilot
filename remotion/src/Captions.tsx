import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {safeBox, scaleFont} from './layout/grid';
import {pickCurrentCaption, splitCaptionIntoChunks, isWordActive} from './caption-logic';
import type {CaptionItem} from './Film';

/**
 * 字幕层(二十八期; 二十九期 Task 5 加逐词高亮)。
 *
 * 真实签名核对(brief 里的示例代码写错了, 这里按 `layout/grid.ts` 的实际签名改):
 * `safeBox(width, height)` 返回的是 `{left, right, top, bottom, innerWidth,
 * innerHeight}` 这套像素值——不是 `{x, y, w, h}`; `scaleFont` 的参数顺序是
 * `(width, height, base)`。只改这里的调用方式, 不碰 grid.ts。
 *
 * 逐词高亮只在 `current.words` 存在时生效(`splitCaptionIntoChunks` 在没有
 * `words` 时原样返回整句一个 chunk, 渲染结果与二十八期整句显示零差异)——
 * 只有 ppt-narration/illustration-tts 两条 TTS 链会填 `words`
 * (`src/lib/video-production/align-captions.ts`), talking-head-broll 没有,
 * 这里不需要关心调用方是谁, 有数据就高亮、没有就保持老行为。
 */

// 给字幕文字预留的框高(按短边缩放), 留够最多两行不越界。
const CAPTION_BOX_HEIGHT_BASE = 120;
const CAPTION_FONT_SIZE_BASE = 44;

export const Captions: React.FC<{
  items: CaptionItem[];
  highlightColor?: string;
  /**
   * pip 常驻小窗对字幕安全区的挤占(二十九期 Task 6 用户验收返工, 可选)。
   *
   * 背景: pip 版式真机验证(155 秒真实出镜素材, 竖屏 1080x1920 源视频铺进
   * 16:9 合成)量出小窗高度能到合成高度的 79%——`Film.tsx` 的 pip 小窗只按
   * 宽度定比例、高度跟源视频宽高比走(与旧链 `computePipRect` 同一先例, 见
   * 该函数注释), 竖屏素材配横屏合成时小窗天生会很"高"。贴底锚定(`bl`/`br`)
   * 的小窗和字幕共享同一条"贴底"基准线, 只要小窗高度超过字幕框自身的高度
   * (`CAPTION_BOX_HEIGHT_BASE`, 通常远小于 79%)就会在水平方向压到字幕。
   *
   * 这里(渲染层)不知道出镜素材的真实宽高比(故意不做 ffprobe, 见
   * `Film.tsx` 的 `FilmInput.sourceVideo` 顶部注释), 没法精确算出小窗实际
   * 像素高度去做"数值上刚好避开"的判断——保守起见: 只要小窗是贴底锚定
   * (`side` 有值), 就无条件让出这一侧的横向空间, 不去猜它到底有多高。
   * 顶部锚定(`tl`/`tr`)的小窗离字幕这条底边通常还有很大余量, `Film.tsx`
   * 调用点不传这个 prop, 这里保持老行为不变。
   */
  pipReserve?: {side: 'left' | 'right'; width: number};
}> = ({
  items,
  // 默认值只是防御性兜底(理论上所有调用点都会显式传 theme.highlight),
  // 与四张卡片组件的"必填但仍给防御性默认值"同一惯例(见 Film.tsx 顶部注释)。
  highlightColor = '#f2c744',
  pipReserve,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const current = pickCurrentCaption(items, nowMs);
  if (!current) return null;

  const box = safeBox(width, height);
  const captionBoxHeight = scaleFont(width, height, CAPTION_BOX_HEIGHT_BASE);
  const chunks = splitCaptionIntoChunks(current.text, current.words);

  // 没有 pipReserve 时 left/boxWidth 与老行为逐字节一致(box.left/box.innerWidth)。
  let left = box.left;
  let boxWidth = box.innerWidth;
  if (pipReserve) {
    if (pipReserve.side === 'right') {
      const newRight = Math.max(left, box.left + box.innerWidth - pipReserve.width);
      boxWidth = Math.max(0, newRight - left);
    } else {
      const newLeft = Math.min(box.left + box.innerWidth, box.left + pipReserve.width);
      boxWidth = Math.max(0, box.left + box.innerWidth - newLeft);
      left = newLeft;
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        left,
        width: boxWidth,
        // 贴着底部安全区上沿: box.bottom 之下是平台 UI 遮挡带(见 grid.ts 顶部
        // 注释), 字幕框自身再留出 captionBoxHeight, 保证文字本身不会探进去。
        top: height - box.bottom - captionBoxHeight,
        height: captionBoxHeight,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: scaleFont(width, height, CAPTION_FONT_SIZE_BASE),
        fontWeight: 700,
        color: 'rgba(20,24,32,0.92)',
        textShadow: '0 1px 2px rgba(255,255,255,0.8)',
        lineHeight: 1.4,
      }}
    >
      {chunks.map((chunk, i) => {
        const active = isWordActive(chunk.word, nowMs);
        return (
          <span
            key={i}
            style={
              active
                ? {color: highlightColor, fontWeight: 900, textShadow: '0 1px 3px rgba(0,0,0,0.35)'}
                : undefined
            }
          >
            {chunk.text}
          </span>
        );
      })}
    </div>
  );
};
