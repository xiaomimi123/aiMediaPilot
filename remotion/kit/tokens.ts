/** 风格 C · 极客手账。所有数值以 spec §4.1 为准, 改这里即改全部片子。 */
export const W = 1080;
export const H = 1920;
export const FPS = 30;

export const C = {
  bg: '#F6F7F9',
  grid: '#E3E7EE',
  ink: '#0F172A',
  muted: '#64748B',
  accent: '#2563EB',
  accentSoft: '#EEF2FF',
  accentInk: '#1E3A8A',
  marker: '#FDE68A',
  card: '#FFFFFF',
} as const;

export const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';
export const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

type Rect = { left: number; top: number; width: number; height: number };
export const ZONE: { pip: Rect; title: Rect; content: Rect; captions: Rect } = {
  pip: { left: W - 60 - 350, top: 70, width: 350, height: 470 },
  title: { left: 60, top: 70, width: 590, height: 470 },
  content: { left: 60, top: 560, width: 960, height: 780 },
  captions: { left: 60, top: 1380, width: 960, height: 120 },
};
