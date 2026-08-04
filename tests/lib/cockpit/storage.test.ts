import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const origFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  global.fetch = origFetch;
});

describe('loadWorkspace', () => {
  it('setupComplete=true → 返回 state', async () => {
    const { loadWorkspace } = await import('@/lib/cockpit/storage');
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { state: { setupComplete: true, foo: 1 }, rev: 'rev-1', extras: { predictions: {} } },
      }),
    })) as any;
    const state = await loadWorkspace();
    expect(state).toEqual({ setupComplete: true, foo: 1 });
  });

  it('setupComplete=false → 返回 null (与原版 IndexedDB 空库行为一致)', async () => {
    const { loadWorkspace } = await import('@/lib/cockpit/storage');
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { state: { setupComplete: false }, rev: 'rev-1', extras: { predictions: {} } },
      }),
    })) as any;
    expect(await loadWorkspace()).toBeNull();
  });
});

describe('saveWorkspace', () => {
  it('PUT 返回 409 → 抛出 ConflictError (而不是普通 Error)', async () => {
    const { saveWorkspace, ConflictError } = await import('@/lib/cockpit/storage');
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ success: false, message: 'conflict' }),
    })) as any;
    await expect(saveWorkspace({} as any)).rejects.toBeInstanceOf(ConflictError);
  });

  it('串行化: 两次几乎同时发起的保存, 同一时刻最多一个 PUT 在途', async () => {
    const { saveWorkspace } = await import('@/lib/cockpit/storage');
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (call === 1) await firstGate;
      inFlight -= 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { rev: `rev-${call}` } }),
      };
    }) as any;

    const p1 = saveWorkspace({} as any);
    const p2 = saveWorkspace({} as any);
    // 让出一个 microtask, 确认第二次保存此刻还没有发出第二个 fetch
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(1);
    releaseFirst();
    await Promise.all([p1, p2]);
    expect(call).toBe(2);
    expect(maxInFlight).toBe(1);
  });

  it('一次保存失败不阻塞队列: 后续保存仍会执行, 且各自 promise 独立反映真实结果', async () => {
    const { saveWorkspace } = await import('@/lib/cockpit/storage');
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 500, json: async () => ({ success: false, message: 'boom' }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { rev: 'rev-2' } }) };
    }) as any;

    await expect(saveWorkspace({} as any)).rejects.toThrow('boom');
    await expect(saveWorkspace({} as any)).resolves.toBeUndefined();
    expect(call).toBe(2);
  });
});
