'use client';

import { useEffect, useState } from 'react';
import { Trash2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { AI_PROVIDERS } from '@/lib/constants';

type Config = {
  id: string;
  provider: string;
  modelId: string;
  isDefault: boolean;
  apiKeyMasked: string;
  createdAt: string;
};

type Status = { kind: 'idle' } | { kind: 'ok'; msg: string } | { kind: 'err'; msg: string };

export default function SettingsPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(false);

  const [provider, setProvider] = useState<string>(AI_PROVIDERS[0].id);
  const [modelId, setModelId] = useState<string>(AI_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [testingId, setTestingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/ai/config');
      const json = await res.json();
      if (json.success) setConfigs(json.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: 'idle' });
    setSaving(true);
    try {
      const res = await fetch('/api/v1/ai/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, modelId, apiKey, isDefault }),
      });
      const json = await res.json();
      if (json.success) {
        setApiKey('');
        setStatus({ kind: 'ok', msg: '已保存' });
        refresh();
      } else {
        setStatus({ kind: 'err', msg: json.message ?? '保存失败' });
      }
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该配置?')) return;
    await fetch(`/api/v1/ai/config/${id}`, { method: 'DELETE' });
    refresh();
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setStatus({ kind: 'idle' });
    try {
      const res = await fetch('/api/v1/ai/config/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId: id }),
      });
      const json = await res.json();
      if (json.success) {
        setStatus({ kind: 'ok', msg: `连通成功: ${json.data.model}` });
      } else {
        setStatus({ kind: 'err', msg: json.message ?? '测试失败' });
      }
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="text-sm text-muted-foreground">配置 AI 文本服务的 API Key</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>添加 / 更新 AI 配置</CardTitle>
          <CardDescription>
            密钥使用 AES-256-GCM 加密后存入数据库,前端不会回显明文。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="provider">服务商</Label>
                <Select
                  id="provider"
                  value={provider}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProvider(next);
                    const p = AI_PROVIDERS.find((x) => x.id === next);
                    if (p) setModelId(p.defaultModel);
                  }}
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="modelId">模型 ID</Label>
                <Input
                  id="modelId"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="gpt-4o-mini"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                required
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="isDefault"
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              <Label htmlFor="isDefault">设为默认</Label>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
              {status.kind === 'ok' && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> {status.msg}
                </span>
              )}
              {status.kind === 'err' && (
                <span className="flex items-center gap-1 text-sm text-destructive">
                  <XCircle className="h-4 w-4" /> {status.msg}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>已配置</CardTitle>
          <CardDescription>每个服务商仅保留一条;同名再次保存会覆盖。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : configs.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无配置</p>
          ) : (
            <ul className="divide-y">
              {configs.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">
                      {c.provider}
                      {c.isDefault && (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.modelId} · {c.apiKeyMasked}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testingId === c.id}
                      onClick={() => handleTest(c.id)}
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${testingId === c.id ? 'animate-spin' : ''}`}
                      />
                      测试
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
