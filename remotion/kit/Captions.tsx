import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT } from './tokens';
import { useLayout } from './layout';
import { captionLayout } from './text';

export type CaptionLine = { startSec: number; endSec: number; text: string };

/** 把 text 里命中 highlights 的片段包成荧光笔 */
function mark(text: string, highlights: string[]): React.ReactNode[] {
  if (highlights.length === 0) return [text];
  const re = new RegExp(`(${highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) =>
    highlights.includes(part) ? (
      <span key={i} style={{ color: C.marker }}>
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

export const Captions: React.FC<{ lines: CaptionLine[]; highlights?: string[] }> = ({ lines, highlights = [] }) => {
  const { ZONE: Z } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const line = lines.find((l) => t >= l.startSec && t < l.endSec);
  if (!line) return null;
  // 按字幕区宽度拆成长度接近的两行(不再出现单字孤行); 放不下就逐级缩小字号
  const { fontSize, rows } = captionLayout(line.text, Z.captions.width);
  return (
    <div style={{ position: 'absolute', ...Z.captions, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          maxWidth: Z.captions.width,
          background: C.ink,
          color: '#fff',
          fontFamily: FONT,
          fontWeight: 700,
          fontSize,
          lineHeight: 1.3,
          padding: '14px 30px',
          borderRadius: 22,
          textAlign: 'center',
        }}
      >
        {rows.map((r, i) => (
          <div key={i}>{mark(r, highlights)}</div>
        ))}
      </div>
    </div>
  );
};
