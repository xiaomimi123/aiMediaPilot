import type { WorkspaceState } from './model';
import type { CockpitExtras } from './extras-types';

let rev = '';
let extras: CockpitExtras = {
  predictions: {},
  account: null,
  settings: { baselinePlays: null, retroMedian: null, retroCount: 0 },
};

/** PUT 返回 409 (rev 与服务端 CockpitPrefs.updatedAt 不匹配) 时抛出 — 调用方据此
 * 区分"真的保存失败"和"别处已经改过, 这份状态已经过期"两种情况。 */
export class ConflictError extends Error {
  constructor(message = '数据已在其他标签页更新，此页面已停止保存') {
    super(message);
    this.name = 'ConflictError';
  }
}

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

async function doSave(state: WorkspaceState): Promise<void> {
  const res = await fetch('/api/v1/cockpit/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, rev }),
  });
  const json = await res.json().catch(() => null);
  if (res.status === 409) throw new ConflictError();
  if (!res.ok || !json?.success) throw new Error(json?.message ?? '保存失败');
  rev = json.data.rev;
}

// 保存串行化: 同一时刻最多一个 PUT 在途。若不串行, 两次几乎同时触发的自动保存会带着
// 同一个 rev 并发发出, 即使服务端有 compare-and-set 保护, 后到的那个也必然拿到 409 —
// 客户端排队保证同一个标签页内的保存严格按发起顺序一个接一个进行, 每次都用上一次
// 保存成功后拿到的最新 rev。链条本身永不因为某一次保存失败而卡死 (仍能继续排后面的
// 保存), 但每次调用返回的 Promise 会把这次自己的保存结果 (成功或失败) 如实抛给调用方。
let saveQueue: Promise<void> = Promise.resolve();

export function saveWorkspace(state: WorkspaceState): Promise<void> {
  const thisSave = saveQueue.then(() => doSave(state));
  // 无论这次保存成功与否, 队列本身都要继续前进 (吞掉错误), 否则一次失败会让后面
  // 所有排队的保存永远拿不到执行机会。真正的错误仍然通过 `thisSave` 抛给这次调用方。
  saveQueue = thisSave.then(
    () => undefined,
    () => undefined,
  );
  return thisSave;
}
