'use client';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProxyConfig } from '@/lib/proxy';

export function StepProxy({
  onNext, onBack,
}: { onNext: (proxy: ProxyConfig | null) => void; onBack: () => void }) {
  const [type, setType] = useState<'none' | 'socks5' | 'http' | 'https'>('none');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const buildProxy = (): ProxyConfig | null => {
    if (type === 'none') return null;
    return {
      type,
      host: host.trim(),
      port: parseInt(port, 10),
      username: username || undefined,
      password: password || undefined,
    };
  };

  const handleTest = async () => {
    const p = buildProxy();
    if (!p) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/proxy/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(p),
      });
      const json = await res.json();
      if (json.success) {
        setResult({ ok: true, msg: `✓ 出口 IP: ${json.data.exitIp} (${json.data.latencyMs} ms)` });
      } else {
        setResult({ ok: false, msg: json.message });
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">网络出口 (可选)</h2>
      <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
        <TabsList>
          <TabsTrigger value="none">直连</TabsTrigger>
          <TabsTrigger value="socks5">SOCKS5</TabsTrigger>
          <TabsTrigger value="http">HTTP</TabsTrigger>
          <TabsTrigger value="https">HTTPS</TabsTrigger>
        </TabsList>
        <TabsContent value="none">
          <p className="text-sm text-muted-foreground">不使用代理,直接用本机网络。</p>
        </TabsContent>
        {(['socks5', 'http', 'https'] as const).map((t) => (
          <TabsContent key={t} value={t}>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>主机</Label>
                  <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="proxy.example.com" />
                </div>
                <div className="space-y-1">
                  <Label>端口</Label>
                  <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="1080" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>用户名 (可选)</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>密码 (可选)</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" disabled={testing || !host || !port} onClick={handleTest}>
                  {testing ? '测试中...' : '↻ 测试连通'}
                </Button>
                {result && <span className={result.ok ? 'text-green-600 text-sm' : 'text-destructive text-sm'}>{result.msg}</span>}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 上一步</Button>
        <Button onClick={() => onNext(buildProxy())}>{type === 'none' ? '跳过 →' : '下一步 →'}</Button>
      </div>
    </div>
  );
}
