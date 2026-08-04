import type { CockpitExtras } from './extras-types';

/**
 * 占位实现 — 真实的 predictions 计算 (L1 baseline / retro median) 由 Task 13 补齐。
 * userId 参数先保留签名, 供后续实现直接替换函数体使用。
 */
export async function loadExtras(_userId: string): Promise<CockpitExtras> {
  return { predictions: {} };
}
