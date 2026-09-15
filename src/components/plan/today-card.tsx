'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { generateTodayScript, produceToday } from '@/lib/content-plan/actions';
import { nextAction, type ContentPlanDayStatus } from '@/lib/content-plan/status-label';

const inputCls =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed ' +
  'focus:border-foreground/40 focus:outline-none';

export interface TodayCardDay {
  topic: string;
  angle: string;
  hookDirection: string;
  status: ContentPlanDayStatus;
  scriptDraftId: string | null;
  videoProductionId: string | null;
  /** 已出片但成片渲染失败 —— 完成态不能庆祝, 要给回修入口。 */
  filmFailed?: boolean;
}

export interface TodayCardTemplateOption {
  id: string;
  name: string;
}

export interface TodayCardProps {
  planId: string;
  dayIndex: number;
  day: TodayCardDay;
  templates: TodayCardTemplateOption[];
  defaultTemplateId: string | null;
  /** 状态变化(生成脚本/换选题/出片/编辑)后回调, 供列表页同步同一天的展示。 */
  onDayUpdated?: (day: TodayCardDay) => void;
}

/**
 * 今天该做什么 —— `/plan` 主态的核心组件, 三态渲染:
 *
 * - pending: 大字选题 + 生成脚本/换选题/改一改
 * - scripted: 脚本就绪卡 + 用模板出片
 * - produced: 完成态
 *
 * `syncFailed`(见 `src/lib/content-plan/actions.ts`)是脚本/片子已经生成、只是
 * PATCH 状态没写进去的中间态 —— 重试只重发那一次 PATCH, 绝不重新调生成接口
 * (那会把用户已经拿到手的稿子/片子作废重来一次, 浪费真金白银的 token/算力)。
 */
export function TodayCard({ planId, dayIndex, day, templates, defaultTemplateId, onDayUpdated }: TodayCardProps) {
  const [state, setState] = useState<TodayCardDay>(day);
  const [editing, setEditing] = useState(false);
  const [draftTopic, setDraftTopic] = useState(day.topic);
  const [draftAngle, setDraftAngle] = useState(day.angle);
  const [draftHook, setDraftHook] = useState(day.hookDirection);
  const [busy, setBusy] = useState<null | 'generate' | 'reroll' | 'produce' | 'edit'>(null);
  const [error, setError] = useState('');
  const [syncFailedKind, setSyncFailedKind] = useState<null | 'scripted' | 'produced'>(null);
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? templates[0]?.id ?? '');

  function update(next: Partial<TodayCardDay>) {
    setState((prev) => {
      const merged = { ...prev, ...next };
      onDayUpdated?.(merged);
      return merged;
    });
  }

  async function handleGenerate() {
    setBusy('generate');
    setError('');
    setSyncFailedKind(null);
    const res = await generateTodayScript({
      planId,
      dayIndex,
      day: { topic: state.topic, angle: state.angle, hookDirection: state.hookDirection },
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (res.syncFailed) {
      // 脚本已经生成, 只是状态没记上 —— 先把 id 记下来, 让重试按钮出现。
      update({ scriptDraftId: res.scriptDraftId });
      setSyncFailedKind('scripted');
      return;
    }
    update({ status: 'scripted', scriptDraftId: res.scriptDraftId });
  }

  async function handleProduce() {
    if (!state.scriptDraftId || !templateId) return;
    setBusy('produce');
    setError('');
    setSyncFailedKind(null);
    const res = await produceToday({
      templateId,
      scriptDraftId: state.scriptDraftId,
      planId,
      dayIndex,
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (res.syncFailed) {
      update({ videoProductionId: res.videoProductionId });
      setSyncFailedKind('produced');
      return;
    }
    update({ status: 'produced', videoProductionId: res.videoProductionId });
  }

  /** syncFailed 重试: 只重发那一次 PATCH, 不再调生成/出片接口。 */
  async function retrySync() {
    if (!syncFailedKind) return;
    setBusy(syncFailedKind === 'scripted' ? 'generate' : 'produce');
    setError('');
    try {
      const body =
        syncFailedKind === 'scripted'
          ? { action: 'mark-scripted', scriptDraftId: state.scriptDraftId }
          : { action: 'mark-produced', videoProductionId: state.videoProductionId };
      const res = await fetch(`/api/v1/content-plans/${planId}/days/${dayIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError('重试仍然失败, 请稍后再试');
        return;
      }
      setSyncFailedKind(null);
      update(syncFailedKind === 'scripted' ? { status: 'scripted' } : { status: 'produced' });
    } finally {
      setBusy(null);
    }
  }

  async function handleReroll() {
    setBusy('reroll');
    setError('');
    try {
      const res = await fetch(`/api/v1/content-plans/${planId}/days/${dayIndex}/reroll`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.message ?? '换选题失败, 请重试');
        return;
      }
      const d = json.data as { topic: string; angle: string; hookDirection: string };
      update({ topic: d.topic, angle: d.angle, hookDirection: d.hookDirection });
      setDraftTopic(d.topic);
      setDraftAngle(d.angle);
      setDraftHook(d.hookDirection);
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit() {
    setBusy('edit');
    setError('');
    try {
      const res = await fetch(`/api/v1/content-plans/${planId}/days/${dayIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', topic: draftTopic, angle: draftAngle, hookDirection: draftHook }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.message ?? '保存失败, 请重试');
        return;
      }
      update({ topic: draftTopic, angle: draftAngle, hookDirection: draftHook });
      setEditing(false);
    } finally {
      setBusy(null);
    }
  }

  const action = nextAction(state.status, {
    scriptDraftId: state.scriptDraftId,
    videoProductionId: state.videoProductionId,
  });

  if (syncFailedKind) {
    return (
      <section className="rounded-lg border border-warn/40 bg-warn-subtle p-5">
        <p className="text-sm font-medium text-fg">
          {syncFailedKind === 'scripted' ? '脚本已生成' : '片子已生成'}但状态没记上
        </p>
        <p className="mt-1 text-xs leading-relaxed text-fg-3">网络抖动导致状态没同步, 内容没丢, 点这里重记一次。</p>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <Button size="sm" className="mt-3" disabled={busy !== null} onClick={() => void retrySync()}>
          {busy !== null ? '重试中…' : '重试同步状态'}
        </Button>
      </section>
    );
  }

  if (action.kind === 'done' && state.filmFailed) {
    return (
      <section className="rounded-lg border border-bad/40 bg-bad-subtle p-5">
        <p className="text-sm font-medium text-bad">片子发起了, 但渲染失败了</p>
        <p className="mt-1.5 text-base font-medium text-fg">{state.topic}</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-3">脚本没丢。去成片页看失败原因, 点「重新制作」就能重跑。</p>
        <Link href={`/films/${action.videoProductionId}`} className="mt-3 inline-block text-xs text-brand hover:text-brand-hover">
          去重新制作 →
        </Link>
      </section>
    );
  }

  if (action.kind === 'done') {
    return (
      <section className="rounded-lg border border-ok/40 bg-ok-subtle p-5">
        <p className="text-sm font-semibold text-ok">今天完成了 🎉</p>
        <p className="mt-1.5 text-base font-medium text-fg">{state.topic}</p>
        <Link href={`/films/${action.videoProductionId}`} className="mt-3 inline-block text-xs text-brand hover:text-brand-hover">
          看成片 →
        </Link>
      </section>
    );
  }

  if (action.kind === 'produce') {
    return (
      <section className="rounded-lg border border-line-subtle bg-surface p-5">
        <p className="t-label">今天的脚本已就绪</p>
        <p className="mt-1.5 text-base font-medium text-fg">{state.topic}</p>
        <Link href={`/write/${action.scriptDraftId}`} className="mt-1.5 inline-block text-xs text-brand hover:text-brand-hover">
          看 / 改稿 →
        </Link>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-4 flex items-center gap-2">
          <select
            aria-label="出片模板"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className={cn(inputCls, 'w-auto')}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy !== null || !templateId} onClick={() => void handleProduce()}>
            {busy === 'produce' ? '出片中…' : '用模板出片'}
          </Button>
        </div>
      </section>
    );
  }

  // pending
  return (
    <section className="rounded-lg border border-line-subtle bg-surface p-5">
      <p className="t-label">今天该讲</p>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            aria-label="选题"
            value={draftTopic}
            maxLength={60}
            onChange={(e) => setDraftTopic(e.target.value)}
            className={inputCls}
          />
          <input
            aria-label="角度"
            value={draftAngle}
            maxLength={120}
            onChange={(e) => setDraftAngle(e.target.value)}
            className={inputCls}
          />
          <input
            aria-label="钩子方向"
            value={draftHook}
            maxLength={120}
            onChange={(e) => setDraftHook(e.target.value)}
            className={inputCls}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void handleSaveEdit()}>
              {busy === 'edit' ? '保存中…' : '保存'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-xl font-semibold text-fg">{state.topic}</p>
          <p className="mt-2 text-xs leading-relaxed text-fg-3">角度: {state.angle}</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-3">钩子方向: {state.hookDirection}</p>

          {busy === 'generate' ? (
            <p className="mt-4 text-xs text-fg-3">AI 正在写今天的逐字稿…(约 30-60 秒)</p>
          ) : error ? (
            <p className="mt-3 text-xs text-destructive">{error}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void handleGenerate()}>
              {busy === 'generate' ? '生成中…' : '生成今日脚本'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void handleReroll()}>
              {busy === 'reroll' ? '换题中…' : '换个选题'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(true)}>
              改一改
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
