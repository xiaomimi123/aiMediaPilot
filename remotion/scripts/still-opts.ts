import path from 'node:path';

/**
 * 关键帧只给出片助手看布局: 半尺寸 jpeg(约 60–80KB/张, 原来全尺寸 png 约 600KB)。
 * 每张看过的图都留在对话里, 图太大时几轮复查就会让请求超出模型服务的上限。
 */
export const STILL_RENDER_OPTS = { imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5 } as const;

export const stillPath = (dir: string, sec: number) => path.join(dir, `${sec}.jpg`);
