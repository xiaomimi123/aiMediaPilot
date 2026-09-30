import type { Script } from './model';

/** agent 的 patch_script 与界面手改共用这一个函数, 保证两边行为一致。 */
export function applySegmentEdit(script: Script, segmentId: string, text: string): Script {
  if (!script.segments.some((s) => s.id === segmentId)) {
    throw new Error(`没有编号为 ${segmentId} 的段落，可用编号：${script.segments.map((s) => s.id).join('、')}`);
  }
  return { segments: script.segments.map((s) => (s.id === segmentId ? { ...s, text: text.trim() } : s)) };
}
