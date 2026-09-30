import { describe, expect, it } from 'vitest';
import { isBehind, postLagAlerts } from '@/lib/predict/lag';

describe('lag', () => {
  it('flags day 1 below 30% and day 2 below 50% of the center', () => {
    expect(isBehind(1.2, 800, 3000)).toBe(true);
    expect(isBehind(1.2, 1000, 3000)).toBe(false);
    expect(isBehind(2.5, 1400, 3000)).toBe(true);
    expect(isBehind(2.5, 1600, 3000)).toBe(false);
  });
  it('does not flag the publish day', () => {
    expect(isBehind(0.5, 10, 3000)).toBe(false);
  });
  it('stops after day 3', () => {
    expect(isBehind(3.1, 10, 3000)).toBe(false);
  });
});

describe('lag alerts', () => {
  it('alerts each lagging work once a day, even two works of one project', async () => {
    const now = new Date('2026-10-02T21:00:00+08:00');
    const works = [
      { id: 'w1', projectId: 'p1', viewCount: 100, publishedAt: new Date(now.getTime() - 1.5 * 86400_000), project: { title: 'A' } },
      { id: 'w2', projectId: 'p1', viewCount: 200, publishedAt: new Date(now.getTime() - 1.2 * 86400_000), project: { title: 'A' } },
    ];
    const msgs: { toolName: string; createdAt: Date }[] = [];
    const db = {
      publishedWork: { findMany: async () => works },
      prediction: { findFirst: async ({ where }: { where: { kind: string } }) => (where.kind === 'final' ? { result: { center: 3000 } } : null) },
      chatMessage: {
        findFirst: async ({ where }: { where: { toolName: string } }) => msgs.find((m) => m.toolName === where.toolName) ?? null,
        create: async ({ data }: { data: { toolName: string } }) => void msgs.push({ toolName: data.toolName, createdAt: now }),
      },
    } as never;
    expect(await postLagAlerts(db, now)).toBe(2);
    expect(await postLagAlerts(db, now)).toBe(0);
  });
});
