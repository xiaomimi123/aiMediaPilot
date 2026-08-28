'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Field, Section, inputCls } from './primitives';

type Status = 'active' | 'candidate' | 'ignored';

interface Keyword {
  id: string;
  text: string;
  status: string;
  source: string;
}

/**
 * 雷达配置。
 *
 * 关键词直接决定选题栏里出现什么 —— 抓到英文内容、抓到不相干的赛道, 根源都在
 * 这里而不在打分。所以关键词的增删改必须能自己动手, 不能只由系统建议。
 *
 * Tavily Key 走**只写不读**: 后端返回的是「配没配」而不是密钥本身。输入框留空
 * 提交 = 保持原样, 想清空要按「清除」—— 把「没改」和「清空」区分开, 否则每次
 * 保存别的字段都会顺手把 Key 抹掉。
 */
export function RadarForm({
  initialKeywords,
  initialConfig,
}: {
  initialKeywords: Keyword[];
  initialConfig: { hasKey: boolean; dailyLimit: number; enabled: boolean };
}) {
  const [keywords, setKeywords] = useState<Keyword[]>(initialKeywords);
  const [draft, setDraft] = useState('');
  const [cfg, setCfg] = useState(initialConfig);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [page, setPage] = useState(0);

  async function addKeyword() {
    const text = draft.trim();
    if (!text) return;
    setBusy('add');
    setError('');
    const res = await fetch('/api/v1/radar/keywords', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await res.json();
    setBusy('');
    if (!res.ok || !body?.success) {
      setError(res.status === 409 ? '这个关键词已经有了' : (body?.message ?? '添加失败'));
      return;
    }
    setKeywords([body.data.keyword as Keyword, ...keywords]);
    setDraft('');
  }

  async function setStatus(id: string, status: Status) {
    setKeywords((ks) => ks.map((k) => (k.id === id ? { ...k, status } : k)));
    await fetch(`/api/v1/radar/keywords/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => setError('改状态失败'));
  }

  async function saveConfig(patch: Record<string, unknown>) {
    setBusy('cfg');
    setError('');
    setNote('');
    const res = await fetch('/api/v1/radar/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    setBusy('');
    if (!res.ok || !body?.success) {
      setError(body?.message ?? '保存失败');
      return;
    }
    if ('tavilyKey' in patch) {
      setCfg((c) => ({ ...c, hasKey: patch.tavilyKey !== '' }));
      setKeyInput('');
      setNote(patch.tavilyKey === '' ? 'Key 已清除。' : 'Key 已保存。');
    } else {
      setNote('已保存。');
    }
  }

  const active = keywords.filter((k) => k.status === 'active');
  const candidates = keywords.filter((k) => k.status === 'candidate');
  const ignored = keywords.filter((k) => k.status === 'ignored');
  const PAGE = 24;
  const shown = candidates.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <>
      <Section
        title="关键词"
        hint="决定雷达抓什么。选题栏里出现不相干或英文内容，根源在这里，不在打分。"
      >
        <div className="flex gap-2">
          <input
            value={draft}
            placeholder="加一个关键词"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addKeyword(); }}
            className={inputCls}
          />
          <Button size="sm" disabled={busy === 'add' || !draft.trim()} onClick={() => void addKeyword()}>
            添加
          </Button>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            在用 · {active.length}
          </p>
          {active.length === 0 ? (
            <p className="mt-1 text-xs text-destructive">
              一个在用的关键词都没有 —— 雷达抓不到任何东西。
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {active.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center gap-2 rounded-md border border-foreground/40 bg-secondary/60 px-2.5 py-1 text-xs"
                >
                  <span>{k.text}</span>
                  <button
                    type="button"
                    onClick={() => void setStatus(k.id, 'ignored')}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    停用
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          候选是一条**分诊队列**, 不是一面标签墙。真机上这里堆了 269 条没人处理
          的候选词(卫星数据、基因表达、国债风险…), 摊平展示等于没展示 —— 一屏
          看不完、看完也不知道处理到哪了。所以分页 + 一键取舍。
        */}
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              候选 · {candidates.length}
            </p>
            {candidates.length > PAGE ? (
              <span className="text-xs text-muted-foreground/60">
                第 {page + 1} / {Math.ceil(candidates.length / PAGE)} 页
              </span>
            ) : null}
            {candidates.length > 50 ? (
              <span className="text-xs text-muted-foreground">
                堆了这么多说明雷达抓得比你消化得快，调低下面的每日上限。
              </span>
            ) : null}
          </div>
          {candidates.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground/60">空</p>
          ) : (
            <>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {shown.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs"
                  >
                    <span>{k.text}</span>
                    <button
                      type="button"
                      onClick={() => void setStatus(k.id, 'active')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      用它
                    </button>
                    <button
                      type="button"
                      onClick={() => void setStatus(k.id, 'ignored')}
                      className="text-muted-foreground/60 hover:text-destructive"
                    >
                      忽略
                    </button>
                  </li>
                ))}
              </ul>
              {candidates.length > PAGE ? (
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((n) => n - 1)}
                    className="text-muted-foreground underline underline-offset-4 disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={(page + 1) * PAGE >= candidates.length}
                    onClick={() => setPage((n) => n + 1)}
                    className="text-muted-foreground underline underline-offset-4 disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground/60">已忽略 · {ignored.length}</p>
      </Section>

      <Section title="抓取" hint="雷达每天跑一轮。关掉之后已有的条目还在，只是不再新增。">
        <Field label="开关">
          <div className="flex gap-1.5">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => { setCfg((c) => ({ ...c, enabled: v })); void saveConfig({ enabled: v }); }}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  cfg.enabled === v
                    ? 'border-foreground bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
                )}
              >
                {v ? '开' : '关'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="每日条数上限" hint="抓得比消化得快，选题栏就会堆积。堆积了就调低它。">
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={cfg.dailyLimit}
              onChange={(e) => setCfg((c) => ({ ...c, dailyLimit: Number(e.target.value) }))}
              className={cn(inputCls, 'w-32 tabular-nums')}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy === 'cfg'}
              onClick={() => void saveConfig({ dailyLimit: cfg.dailyLimit })}
            >
              保存
            </Button>
          </div>
        </Field>
      </Section>

      <Section
        title="Tavily Key"
        hint="雷达和写稿的联网研究都用它。系统只告诉你配没配，不回显密钥。"
      >
        <Field
          label={cfg.hasKey ? '已配置' : '未配置'}
          hint="留空保存 = 保持原样。要清空请按「清除」。"
        >
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              placeholder={cfg.hasKey ? '已有 Key，留空则不改' : 'tvly-…'}
              onChange={(e) => setKeyInput(e.target.value)}
              className={inputCls}
              autoComplete="off"
            />
            <Button
              size="sm"
              disabled={busy === 'cfg' || !keyInput.trim()}
              onClick={() => void saveConfig({ tavilyKey: keyInput.trim() })}
            >
              保存
            </Button>
            {cfg.hasKey ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === 'cfg'}
                onClick={() => void saveConfig({ tavilyKey: '' })}
              >
                清除
              </Button>
            ) : null}
          </div>
        </Field>
      </Section>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </>
  );
}
