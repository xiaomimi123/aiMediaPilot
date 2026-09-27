import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT, ZONE } from './tokens';

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
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const line = lines.find((l) => t >= l.startSec && t < l.endSec);
  if (!line) return null;
  return (
    <div style={{ position: 'absolute', ...ZONE.captions, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          maxWidth: ZONE.captions.width,
          background: C.ink,
          color: '#fff',
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.3,
          padding: '14px 30px',
          borderRadius: 22,
          textAlign: 'center',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {mark(line.text, highlights)}
      </div>
    </div>
  );
};
