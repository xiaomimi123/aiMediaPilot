'use client';

import { useRef } from 'react';
import { overlayPosition, type OverlayAspect, type OverlayItem, type OverlayPersonSide } from '@/lib/video-production/overlay-plan';

/**
 * 剪辑台叠加元素画布拖拽层(三十七期 Task 6)——预览 Player 上叠一层把手,
 * 拖动即时回调归一化坐标, 由 workbench 写回 `overlayItems[idx].x/y`。
 *
 * **本任务铁律**: 这里的每一个把手位置都必须调 `overlayPosition`
 * (渲染层 `TextOverlayLayer.tsx` 用的同一个函数, remotion 侧 `position.ts`
 * 转发到这里), **不许自算格位几何**——本仓吃过"编辑台画布与渲染坐标是两套"
 * 的亏(见 `position.ts`/`overlay-plan.ts` 顶部注释)。测试用变异
 * `overlayPosition` 常数的方式钉住这条纪律。
 *
 * **纯 props 组件**——不自己拉数据、不自己管 items 的 state, 由
 * `film-plan-workbench.tsx` 管 `overlayItems` state 并把 `onPositionChange`
 * 接到 `setOverlayItems`。这样能被单测直接挂载(同 `OverlayEditor` 惯例)。
 *
 * **定位方式**: 父容器(`plan-preview.tsx` 里包住 Player 的那层)必须
 * `position: relative`, 这里渲染 `position: absolute; inset: 0` 的透明层,
 * 把手用 `left/top` 百分比(`overlayPosition(...).x/y * 100`)摆放——与渲染层
 * `pos.x * width`/`pos.y * height` 换算到同一坐标系, 只是渲染层用像素、这里
 * 用百分比(不需要知道容器像素尺寸就能对齐, 容器 resize 也不用重算)。
 *
 * **拖拽换算**: pointerdown 记录 `pointerId`, pointermove 时读事件的
 * `clientX/clientY`, 减去容器(`containerRef`, 也就是这层自身, inset:0 与
 * 父容器同尺寸)的 `getBoundingClientRect()` 换算成容器内相对坐标, 除以容器
 * 宽高得到 0~1 归一化值, `clamp(0,1)` 后回调。用 Pointer Events(而不是
 * mouse/touch 两套)——`setPointerCapture` 保证拖出把手范围外(甚至拖出浏览器
 * 窗口)时事件仍然稳定跟随, 触屏同一套逻辑就能用。
 */

const KIND_COLOR: Record<OverlayItem['kind'], string> = {
  keyword: '#2f6bff',
  note: '#22c55e',
  arrow: '#f59e0b',
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export interface OverlayDragLayerProps {
  items: OverlayItem[];
  aspect: OverlayAspect;
  personSide: OverlayPersonSide;
  /** 拖完(或拖动中, 节流后)回调——`idx` 是调用方数组里的下标(单镜模式下
   * 由调用方映射回原始下标, 见 `plan-preview.tsx` 的 `origIdx` 用法), `pos`
   * 是 clamp 到 0~1 的归一化坐标。 */
  onPositionChange: (idx: number, pos: { x: number; y: number }) => void;
}

export function OverlayDragLayer({ items, aspect, personSide, onPositionChange }: OverlayDragLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ idx: number; pointerId: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    // 单拖语义(终审 important): draggingRef 只有一个, 第二根手指按下会覆盖第一根的
    // 追踪状态, 让先拖的那个中途僵住 —— 已有活跃拖拽时直接忽略新的按下。
    if (draggingRef.current) return;
    draggingRef.current = { idx, pointerId: e.pointerId };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function updateFromClientPoint(idx: number, clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    onPositionChange(idx, { x, y });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const dragging = draggingRef.current;
    if (!dragging || dragging.pointerId !== e.pointerId) return;
    updateFromClientPoint(dragging.idx, e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const dragging = draggingRef.current;
    if (!dragging || dragging.pointerId !== e.pointerId) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    draggingRef.current = null;
  }

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {items.map((item, idx) => {
        const pos = overlayPosition(aspect, personSide, item);
        const label = item.kind === 'arrow' ? '↓' : item.text.slice(0, 4);
        return (
          <div
            key={idx}
            data-overlay-handle-idx={idx}
            onPointerDown={(e) => handlePointerDown(e, idx)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              position: 'absolute',
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              transform: pos.anchor === 'bottom' ? 'translate(-50%, calc(-100% + 0px))' : 'translate(-50%, -50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              borderRadius: 9999,
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              fontSize: 11,
              whiteSpace: 'nowrap',
              cursor: 'grab',
              pointerEvents: 'auto',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: KIND_COLOR[item.kind],
                flexShrink: 0,
              }}
            />
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
