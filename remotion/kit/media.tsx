import React from 'react';
import { Img, OffthreadVideo, staticFile, useVideoConfig } from 'remotion';
import { C, MONO } from './tokens';

/** 浏览器窗 / 手机外框, 用来装录屏、截图、图片 */
export const WindowFrame: React.FC<{ kind: 'browser' | 'phone'; title?: string; children: React.ReactNode }> = ({ kind, title, children }) =>
  kind === 'browser' ? (
    <div style={{ background: C.card, borderRadius: 28, overflow: 'hidden', boxShadow: '0 24px 60px rgba(15,23,42,0.14)', border: `2px solid ${C.grid}` }}>
      <div style={{ height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px', background: '#EEF1F5' }}>
        {['#F87171', '#FBBF24', '#34D399'].map((c) => (
          <span key={c} style={{ width: 20, height: 20, borderRadius: 10, background: c }} />
        ))}
        {title && <span style={{ marginLeft: 16, fontFamily: MONO, fontSize: 26, color: C.muted }}>{title}</span>}
      </div>
      <div style={{ position: 'relative', background: '#000' }}>{children}</div>
    </div>
  ) : (
    <div style={{ width: 430, margin: '0 auto', borderRadius: 60, padding: 18, background: C.ink, boxShadow: '0 24px 60px rgba(15,23,42,0.25)' }}>
      <div style={{ borderRadius: 44, overflow: 'hidden', background: '#000' }}>{children}</div>
    </div>
  );

/**
 * 素材: 图片或视频(静音)。视频从 clipFromSec 开始, 按 speed 倍速播放(≤2, 由 film check 保证)。
 * 在 <Shot> 里使用时, 播放从镜头开始那一帧算起。
 */
export const MediaIn: React.FC<{
  file: string;
  type: 'image' | 'video';
  clipFromSec?: number;
  speed?: number;
  fit?: 'contain' | 'cover';
  height?: number;
}> = ({ file, type, clipFromSec = 0, speed = 1, fit = 'contain', height = 600 }) => {
  const { fps } = useVideoConfig();
  const style: React.CSSProperties = { width: '100%', height, objectFit: fit, display: 'block' };
  return type === 'image' ? (
    <Img src={staticFile(file)} style={style} />
  ) : (
    <OffthreadVideo src={staticFile(file)} muted startFrom={Math.round(clipFromSec * fps)} playbackRate={speed} style={style} />
  );
};
