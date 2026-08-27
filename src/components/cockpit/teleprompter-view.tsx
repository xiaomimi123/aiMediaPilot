"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildTeleprompterScript,
  estimateActSpeed,
  COMFORTABLE_SPEED,
} from "@/lib/cockpit/teleprompter";

interface ActLike {
  act: string;
  title: string;
  narration: string;
  targetSec: number;
}

/** 每秒滚动像素的基准 —— 用户用倍速在此之上调整。 */
const BASE_PX_PER_SEC = 28;

/**
 * 提词器(二十一期)。
 *
 * 动因: 用户用 iPhone 录口播时没有提词器, 只能一直看屏幕找词, 出不来流畅的表达。
 * 场景是「手机架在电脑前面, 人看电脑念」, 所以做成电脑上的全屏滚动页。
 *
 * 设计要点:
 * - 深底大字 —— 离屏幕一两米也看得清
 * - 空格键控制开始/暂停, 上下键调速: 录制时手不方便精确点按钮
 * - 每幕标出目标秒数与实际所需语速, 字数配不上时长时开录前就提示, 不用录到
 *   一半才发现念不完
 */
export function TeleprompterView({ acts, title }: { acts: ActLike[]; title: string }) {
  const rows = buildTeleprompterScript(acts);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const totalSec = rows.reduce((n, r) => n + r.targetSec, 0);

  const step = useCallback((ts: number) => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastTsRef.current !== null) {
      const dt = (ts - lastTsRef.current) / 1000;
      el.scrollTop += BASE_PX_PER_SEC * speed * dt;
    }
    lastTsRef.current = ts;
    rafRef.current = requestAnimationFrame(step);
  }, [speed]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [playing, step]);

  // 录制时手在镜头前, 不方便去点按钮 —— 键盘操作是刚需
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.code === "ArrowUp") { e.preventDefault(); setSpeed((s) => Math.min(3, +(s + 0.1).toFixed(1))); }
      else if (e.code === "ArrowDown") { e.preventDefault(); setSpeed((s) => Math.max(0.3, +(s - 0.1).toFixed(1))); }
      else if (e.code === "KeyR") { e.preventDefault(); setPlaying(false); scrollRef.current?.scrollTo({ top: 0 }); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (rows.length === 0) {
    return <section className="teleprompter-empty">
      <p>这条内容还没有六幕稿，先去写稿再来提词。</p>
    </section>;
  }

  return <section className="teleprompter">
    <div className="teleprompter-bar">
      <span className="teleprompter-title">{title}</span>
      <span className="teleprompter-total">全片 {totalSec} 秒</span>
      <button type="button" className="primary-button" onClick={() => setPlaying((p) => !p)}>
        {playing ? "暂停" : "开始"}
      </button>
      <span className="teleprompter-speed">{speed.toFixed(1)}×</span>
      <button type="button" className="text-button" onClick={() => setSpeed((s) => Math.max(0.3, +(s - 0.1).toFixed(1)))}>慢</button>
      <button type="button" className="text-button" onClick={() => setSpeed((s) => Math.min(3, +(s + 0.1).toFixed(1)))}>快</button>
      <button type="button" className="text-button" onClick={() => { setPlaying(false); scrollRef.current?.scrollTo({ top: 0 }); }}>回到开头</button>
      <span className="teleprompter-hint">空格 开始/暂停 · ↑↓ 调速 · R 回到开头</span>
    </div>

    <div className="teleprompter-scroll" ref={scrollRef}>
      {/* 顶部留白: 让第一句从屏幕中间开始, 视线不用往上抬 */}
      <div className="teleprompter-pad" />
      {rows.map((r) => {
        const speedNeeded = estimateActSpeed(r.narration, r.targetSec);
        const tooFast = speedNeeded > COMFORTABLE_SPEED.max;
        const tooSlow = speedNeeded > 0 && speedNeeded < COMFORTABLE_SPEED.min;
        return <div key={r.act} className="teleprompter-act">
          <div className="teleprompter-act-head">
            <span>{r.title}</span>
            <span>{r.startSec}s – {r.startSec + r.targetSec}s（{r.targetSec} 秒）</span>
            {tooFast ? <span className="teleprompter-warn">字偏多，要念到 {speedNeeded.toFixed(1)} 字/秒</span> : null}
            {tooSlow ? <span className="teleprompter-warn">字偏少，只需 {speedNeeded.toFixed(1)} 字/秒</span> : null}
          </div>
          {r.lines.map((line, i) => <p key={i} className="teleprompter-line">{line}</p>)}
        </div>;
      })}
      <div className="teleprompter-pad" />
    </div>
  </section>;
}
