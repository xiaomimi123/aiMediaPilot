export type ProxyConfig = {
  type: 'socks5' | 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type ProxyTestResult = {
  ok: boolean;
  exitIp?: string;
  geo?: string;
  latencyMs?: number;
  error?: string;
};

export function toPlaywrightProxy(p: ProxyConfig) {
  const scheme = p.type === 'socks5' ? 'socks5' : p.type;
  return {
    server: `${scheme}://${p.host}:${p.port}`,
    username: p.username,
    password: p.password,
  };
}

export function validateProxyShape(p: Partial<ProxyConfig>): string | null {
  if (!p.type) return 'type required';
  if (!['socks5', 'http', 'https'].includes(p.type)) return 'invalid type';
  if (!p.host || typeof p.host !== 'string') return 'host required';
  if (!p.port || typeof p.port !== 'number' || p.port < 1 || p.port > 65535)
    return 'port out of range';
  if (p.username !== undefined && typeof p.username !== 'string')
    return 'username must be string';
  if (p.password !== undefined && typeof p.password !== 'string')
    return 'password must be string';
  return null;
}
