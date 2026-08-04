import type { WorkspaceState } from './model';
import type { CockpitExtras } from './extras-types';

let rev = '';
let extras: CockpitExtras = { predictions: {} };

export function getExtras(): CockpitExtras { return extras; }

export async function loadWorkspace(): Promise<WorkspaceState | null> {
  const res = await fetch('/api/v1/cockpit/workspace');
  const json = await res.json();
  if (!res.ok || !json.success) return null;
  rev = json.data.rev;
  extras = json.data.extras;
  const state = json.data.state as WorkspaceState;
  return state.setupComplete ? state : null; // 未完成 onboarding 时与原版 IndexedDB 空库行为一致
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  const res = await fetch('/api/v1/cockpit/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, rev }),
  });
  const json = await res.json().catch(() => null);
  if (res.status === 409) throw new Error('conflict: 其他标签页已保存，请刷新页面');
  if (!res.ok || !json?.success) throw new Error(json?.message ?? '保存失败');
  rev = json.data.rev;
}
