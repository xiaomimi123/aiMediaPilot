import React, { createContext, useContext } from 'react';
import { layoutFor, type Orientation } from './tokens';

const OrientationCtx = createContext<Orientation>('portrait');

/** 片子目录的 index.tsx 用它包住 Film: 画框、小窗、字幕按版式取区块, Film.tsx 不用关心 */
export const OrientationProvider: React.FC<{
  value: Orientation;
  children: React.ReactNode;
}> = ({ value, children }) => <OrientationCtx.Provider value={value}>{children}</OrientationCtx.Provider>;

export const useLayout = () => layoutFor(useContext(OrientationCtx));
