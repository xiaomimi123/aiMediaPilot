import { describe, expect, it } from 'vitest';
import { toPlaywrightProxy, validateProxyShape } from '@/lib/proxy';

describe('toPlaywrightProxy', () => {
  it('socks5 with auth', () => {
    expect(
      toPlaywrightProxy({ type: 'socks5', host: 'p.com', port: 1080, username: 'u', password: 'p' })
    ).toEqual({ server: 'socks5://p.com:1080', username: 'u', password: 'p' });
  });

  it('http without auth', () => {
    expect(toPlaywrightProxy({ type: 'http', host: 'p.com', port: 8080 })).toEqual({
      server: 'http://p.com:8080',
      username: undefined,
      password: undefined,
    });
  });
});

describe('validateProxyShape', () => {
  it('valid socks5', () => {
    expect(validateProxyShape({ type: 'socks5', host: 'p.com', port: 1080 })).toBeNull();
  });

  it('missing host', () => {
    expect(validateProxyShape({ type: 'socks5', port: 1080 } as any)).toMatch(/host/);
  });

  it('port out of range', () => {
    expect(validateProxyShape({ type: 'http', host: 'p.com', port: 99999 })).toMatch(/port/);
  });

  it('invalid type', () => {
    expect(validateProxyShape({ type: 'ftp' as any, host: 'p.com', port: 80 })).toMatch(/type/);
  });
});
