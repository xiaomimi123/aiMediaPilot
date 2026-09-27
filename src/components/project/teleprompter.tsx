'use client';

import { useEffect, useRef, useState } from 'react';
import type { Script } from '@/lib/script/model';
import { CHARS_PER_SEC, countSpokenChars } from '@/lib/script/duration';

/** 按"整篇字数 ÷ 语速"算出滚完全文所需秒数, 再换成每秒滚动像素。 */
export function scrollSpeedPxPerSec(scrollableHeight: number, totalChars: number, charsPerSec: number): number {
  if (scrollableHeight <= 0 || totalChars <= 0) return 0;
  return (scrollableHeight * charsPerSec) / totalChars;
}

const MIN_CPS = 3;
const MAX_CPS = 8;

export function Teleprompter({ script, onClose }: { script: Script; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cps, setCps] = useState(CHARS_PER_SEC);
  const totalChars = script.segments.reduce((n, s) => n + countSpokenChars(s.text), 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowUp') setCps((c) => Math.min(MAX_CPS, c + 1));
      else if (e.key === 'ArrowDown') setCps((c) => Math.max(MIN_CPS, c - 1));
      else if (e.key === 'r' || e.key === 'R') box.current?.scrollTo({ top: 0 });
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!playing) return;
    // 测试环境(jsdom)不一定有 requestAnimationFrame
    const requestFrame = window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
    const cancelFrame = window.cancelAnimationFrame ?? window.clearTimeout;
    let raf = 0;
    let last = performance.now();
    let carry = 0; // scrollTop 只接受整数像素, 累积小数部分
    const tick = (now: number) => {
      const el = box.current;
      if (el) {
        const speed = scrollSpeedPxPerSec(el.scrollHeight - el.clientHeight, totalChars, cps);
        carry += (speed * (now - last)) / 1000;
        const step = Math.floor(carry);
        if (step > 0) {
          el.scrollTop += step;
          carry -= step;
        }
      }
      last = now;
      raf = requestFrame(tick);
    };
    raf = requestFrame(tick);
    return () => cancelFrame(raf);
  }, [playing, cps, totalChars]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div ref={box} className="flex-1 overflow-y-auto px-[8vw] py-[40vh]">
        {script.segments.map((s) => (
          <p key={s.id} className="mb-10 text-[clamp(28px,4vw,56px)] font-medium leading-[1.6]">
            {s.text}
          </p>
        ))}
      </div>
      <div className="flex items-center gap-6 border-t border-white/10 px-6 py-3 text-sm text-white/70">
        <span>{playing ? '空格 暂停' : '空格 开始'}</span>
        <span>语速 {cps} 字/秒</span>
        <span>↑↓ 调速 · R 回到开头 · Esc 退出</span>
        <div className="flex-1" />
        <button className="rounded-md border border-white/20 px-3 py-1 hover:bg-white/10" onClick={onClose}>
          退出
        </button>
      </div>
    </div>
  );
}
