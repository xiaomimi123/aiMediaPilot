'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskView } from '@/app/api/settings/tasks/route';

const pad = (n: number) => String(n).padStart(2, '0');

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

function TaskCard({ t, onChanged }: { t: TaskView; onChanged: (justStarted?: boolean) => void }) {
  const [startedAt, setStartedAt] = useState(0);
  const [time, setTime] = useState(`${pad(t.schedule.hour)}:${pad(t.schedule.minute)}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTime(`${pad(t.schedule.hour)}:${pad(t.schedule.minute)}`), [t.schedule.hour, t.schedule.minute]);

  const setSchedule = async (enabled: boolean) => {
    const [hour, minute] = time.split(':').map(Number);
    setBusy(true);
    const j = await call(`/api/settings/tasks/${t.key}/schedule`, 'PUT', { enabled, hour, minute });
    setBusy(false);
    setMsg(j.success ? { ok: true, text: enabled ? `已开启，每晚 ${time} 自动跑。` : '已关闭定时。' } : { ok: false, text: j.message });
    onChanged();
  };
  const runNow = async () => {
    setBusy(true);
    const j = await call(`/api/settings/tasks/${t.key}/run`, 'POST');
    setBusy(false);
    setMsg(j.success ? { ok: true, text: `已开始，今天还能手动跑 ${j.data.left} 次。` } : { ok: false, text: j.message });
    if (j.success) setStartedAt(Date.now());
    onChanged(j.success);
  };

  // 脚本起来要一两秒, 这期间进程还查不到: 刚点完的 20 秒按"正在跑"显示, 防止连点
  const running = t.running || Date.now() - startedAt < 20_000;
  const status = running
    ? '正在跑…'
    : t.state === 'ok'
      ? `上次成功：${new Date(t.lastSuccessAt!).toLocaleString('zh-CN')}${t.lastMessage ? ` · ${t.lastMessage}` : ''}`
      : t.hint;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{t.label}</b>
        <span className={`text-xs ${t.schedule.enabled ? 'text-[var(--success)]' : 'text-[var(--text-tertiary)]'}`}>
          {t.schedule.enabled ? `定时已开 · 每晚 ${pad(t.schedule.hour)}:${pad(t.schedule.minute)}` : '定时未开'}
        </span>
      </div>
      <p className={`mt-1 text-xs ${running || t.state === 'ok' ? 'text-[var(--text-secondary)]' : 'text-[var(--warning)]'}`}>{status}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button className="rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--text-on-accent)] disabled:opacity-50" disabled={busy || running || t.manualLeft === 0} onClick={() => void runNow()}>
          {running ? '正在跑…' : '立即运行'}
        </button>
        <span className="text-xs text-[var(--text-tertiary)]">今天还能手动 {t.manualLeft} 次</span>
        <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />
        <input type="time" className="rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-0.5 text-sm" value={time} onChange={(e) => setTime(e.target.value)} />
        {t.schedule.enabled ? (
          <>
            <button className="rounded-md border border-[var(--border-strong)] px-3 py-1" disabled={busy} onClick={() => void setSchedule(true)}>改时间</button>
            <button className="text-xs text-[var(--text-tertiary)]" disabled={busy} onClick={() => void setSchedule(false)}>关闭定时</button>
          </>
        ) : (
          <button className="rounded-md border border-[var(--border-strong)] px-3 py-1" disabled={busy} onClick={() => void setSchedule(true)}>开启每晚定时</button>
        )}
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </div>
  );
}

export function NightlyTasks() {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [pollUntil, setPollUntil] = useState(0);
  const load = useCallback(async () => {
    const j = await call('/api/settings/tasks', 'GET');
    setTasks(j.success ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // 有任务在跑、或刚点了立即运行时, 每 5 秒刷新
  useEffect(() => {
    if (!tasks?.some((t) => t.running) && Date.now() > pollUntil) return;
    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [tasks, load, pollUntil]);

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h3 className="mb-1 text-sm font-medium">每晚任务</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">都用 ego lite 里登录的抖音账号只读访问。定时靠 Mac 的系统定时任务，电脑需开着且 ego lite 在运行。手动每天最多 3 次，保护账号。</p>
      {tasks === null ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.key}
              t={t}
              onChanged={(justStarted) => {
                if (justStarted) setPollUntil(Date.now() + 20_000);
                void load();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
