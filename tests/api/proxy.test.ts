import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/v1/proxy/test/route';

vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: vi.fn(async () => ({
      newContext: vi.fn(async () => ({
        newPage: vi.fn(async () => ({
          goto: vi.fn(),
          locator: () => ({ innerText: vi.fn(async () => '{"ip":"1.2.3.4"}') }),
        })),
        close: vi.fn(async () => {}),
      })),
      close: vi.fn(async () => {}),
    })),
  },
}));

describe('POST /api/v1/proxy/test', () => {
  it('validation rejects missing host', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ type: 'socks5', port: 1080 }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('happy path returns exit ip', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ type: 'socks5', host: 'p.com', port: 1080 }),
    });
    const res = await POST(req as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.exitIp).toBe('1.2.3.4');
  });
});
