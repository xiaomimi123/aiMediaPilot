/** 片子版式(与 remotion/kit 的 Orientation 同值; 主项目不直接引用 remotion 子工程) */
export type FilmOrientation = 'portrait' | 'landscape';

export const isFilmOrientation = (v: unknown): v is FilmOrientation => v === 'portrait' || v === 'landscape';

export const orientationLabel = (o: FilmOrientation) => (o === 'landscape' ? '横版' : '竖版');
