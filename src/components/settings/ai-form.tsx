'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AI_PROVIDERS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Field, Section, inputCls } from './primitives';

interface Config {
  id: string;
  provider: string;
  modelId: string;
  isDefault: boolean;
  apiKeyMasked: string;
}

/**
 * 模型与密钥。
 *
 * **密钥只写不读**: 后端存的是加密值, 返回的是掩码。这里的输入框永远从空开始,
 * 也永远不回填 —— 一个显示着 `sk-****` 的输入框会让人以为改一个字符就能改
 * 密钥, 实际上提交的是那串星号。
 *
 * 「测一下」调 `/ai/config/test` 走一次真实请求。配错 Key 的症状是生成时报一个
 * 看不懂的错, 隔着一层很难判断是 Key 的问题还是 prompt 的问题, 所以给一个当场
 * 能验的按钮。
 */
export function AiForm({
  initialConfigs,
  initialTts,
}: {
  initialConfigs: Config[];
  initialTts: { hasConfig: boolean; resourceId: string; voiceType: string };
}) {
  const [configs, setConfigs] = useState<Config[]>(initialConfigs);
  const [provider, setProvider] = useState<string>(AI_PROVIDERS[1].id);
  const [modelId, setModelId] = useState<string>(AI_PROVIDERS[1].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const [tts, setTts] = useState(initialTts);
  const [ttsKey, setTtsKey] = useState('');

  async function addConfig() {
    if (!apiKey.trim()) return;
    setBusy('add');
    setError('');
    setNote('');
    const res = await fetch('/api/v1/ai/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, modelId, apiKey: apiKey.trim(), isDefault: makeDefault }),
    });
    const body = await res.json();
    setBusy('');
    if (!res.ok || !body?.success) {
      setError(body?.message ?? '保存失败');
      return;
    }
    setApiKey('');
    // 重新拉一遍: 设为默认会连带改动其它行的 isDefault, 本地推算容易和库里不一致
    const list = await fetch('/api/v1/ai/config').then((r) => r.json());
    if (list?.success) setConfigs(list.data as Config[]);
    setNote('已保存。');
  }

  async function test(configId: string) {
    setBusy(configId);
    setError('');
    setNote('');
    const res = await fetch('/api/v1/ai/config/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ configId }),
    });
    const body = await res.json();
    setBusy('');
    if (res.ok && body?.success) setNote('连通正常。');
    else setError(body?.message ?? '测试失败');
  }

  async function removeConfig(id: string) {
    setBusy(id);
    const res = await fetch(`/api/v1/ai/config/${id}`, { method: 'DELETE' });
    setBusy('');
    if (res.ok) setConfigs((cs) => cs.filter((c) => c.id !== id));
    else setError('删除失败');
  }

  async function saveTts() {
    if (!ttsKey.trim()) return;
    setBusy('tts');
    setError('');
    setNote('');
    const res = await fetch('/api/v1/tts/volc-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: ttsKey.trim(),
        resourceId: tts.resourceId,
        voiceType: tts.voiceType,
      }),
    });
    const body = await res.json();
    setBusy('');
    if (!res.ok || !body?.success) {
      setError(body?.message ?? '保存失败');
      return;
    }
    setTts((t) => ({ ...t, hasConfig: true }));
    setTtsKey('');
    setNote('语音合成配置已保存。');
  }

  return (
    <>
      <Section title="已配置的模型">
        {configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有配置。没有可用模型时，写稿、拆解、出片都跑不起来。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {configs.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2.5 text-sm"
              >
                <span className="font-medium">
                  {AI_PROVIDERS.find((p) => p.id === c.provider)?.label ?? c.provider}
                </span>
                <span className="text-xs text-muted-foreground">{c.modelId}</span>
                <span className="font-mono text-xs text-muted-foreground/70">{c.apiKeyMasked}</span>
                {c.isDefault ? (
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs">默认</span>
                ) : null}
                <div className="ml-auto flex gap-3 text-xs">
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void test(c.id)}
                    className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {busy === c.id ? '测试中…' : '测一下'}
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void removeConfig(c.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="加一个" hint="密钥保存后只回显掩码，输入框永远从空开始。">
        <Field label="服务商">
          <div className="flex flex-wrap gap-1.5">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProvider(p.id); setModelId(p.defaultModel); }}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  provider === p.id
                    ? 'border-foreground bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="模型 ID">
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} className={inputCls} />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴你的 Key"
            autoComplete="off"
            className={inputCls}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
          />
          设为默认
        </label>
        <Button size="sm" className="self-start" disabled={busy === 'add' || !apiKey.trim()} onClick={() => void addConfig()}>
          {busy === 'add' ? '保存中…' : '保存'}
        </Button>
      </Section>

      <Section
        title="语音合成（火山引擎）"
        hint="插画配音模式用它把稿子念出来。不用那个模式可以不配。"
      >
        <Field label={tts.hasConfig ? 'API Key（已配置）' : 'API Key（未配置）'}>
          <input
            type="password"
            value={ttsKey}
            onChange={(e) => setTtsKey(e.target.value)}
            placeholder={tts.hasConfig ? '已有 Key，留空则不改' : '粘贴 Key'}
            autoComplete="off"
            className={inputCls}
          />
        </Field>
        <Field label="音色" hint="改音色也要重新填一次 Key —— 接口收的是整份配置。">
          <input
            value={tts.voiceType}
            onChange={(e) => setTts((t) => ({ ...t, voiceType: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="资源档位">
          <input
            value={tts.resourceId}
            onChange={(e) => setTts((t) => ({ ...t, resourceId: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Button size="sm" className="self-start" disabled={busy === 'tts' || !ttsKey.trim()} onClick={() => void saveTts()}>
          {busy === 'tts' ? '保存中…' : '保存'}
        </Button>
      </Section>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </>
  );
}
