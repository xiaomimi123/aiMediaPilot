import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { collectWorkMetrics } from '@/lib/retro/collect-step';

const page = JSON.parse(fs.readFileSync('tests/fixtures/douyin/work-list.json', 'utf8'));

describe('collectWorkMetrics', () => {
  it('pairs every page and reports updated / snapshots / skipped', async () => {
    const broken = { ...page, items: page.items.map((it: { create_time: number }, i: number) => (i === 0 ? { ...it, create_time: 1 } : it)) };
    const save = vi.fn(async (rows: unknown[]) => ({ updated: rows.length, snapshots: 1 }));
    const line = await collectWorkMetrics({ runScript: async () => `x\n@@RESULT@@${JSON.stringify([page, broken])}\n`, save });
    expect(save.mock.calls[0][0]).toHaveLength(7);
    expect(line).toBe('作品指标: 7 条(快照 1 条, 跳过 1 条)');
  });
});
