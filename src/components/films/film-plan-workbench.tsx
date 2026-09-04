'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CARD_TYPES, type CardType } from '@/lib/video-production/shot-plan';

/**
 * 剪辑台(三十一期 Task 4)。
 *
 * 挂在 `film-detail.tsx`、`status === 'plan_ready'` 时出现——任务在生成 FilmPlan
 * 之后、正式渲染之前主动停在这里等人逐镜调整。地基(前三个任务)已经就绪:
 * `GET/PUT .../film-plan` 读写方案、`GET .../shot-still/[shotIndex]` 出卡面缩略图、
 * `POST .../render`(确认渲染)与 `POST .../start`(重新生成, 会覆盖这里的改动)。
 *
 * **自己拉数据, 不占 `film-detail.tsx` 的 `initial` props。** GET 只在
 * `plan_ready` 这一刻有意义, 而 `film-detail.tsx` 的初始数据是详情页在任意状态下
 * 都要渲染的——把这份只在一种状态下用得上的数据塞进公共 `Film` 接口, 会让
 * 那份接口为一个特例长胖。挂载点保持"进来再拉", 组件自己管加载态。
 *
 * **单页纵向结构**——二十三期已经实测过页面级两栏被否决(见 `film-detail.tsx`
 * 顶部大段注释:「时间线要宽度、画布要高度, 这两个诉求正交」)。这里同一结论
 * 复用: 缩略图条要宽度(横向滚动), 编辑抽屉要能放下动态字段表单, 两者叠放
 * 比并排更稳, 不用再验一次。
 */

/** 分镜的本地编辑态形状——刻意不用 `shot-plan.ts` 导出的 zod 推断类型
 * (`ShotPlan`/`FilmPlan`)。那份类型是给"已经通过校验"的方案用的判别联合;
 * 编辑过程中字段可以暂时是空字符串、`value` 可以暂时是 0——这些状态在
 * 判别联合下类型体操成本很高, 也没有实际收益(服务端 PUT 会用同一份 zod
 * schema 重新校验一遍, 这里的类型宽松不会绕过真正的把关)。 */
interface LocalShot {
  shotId: string;
  startMs: number;
  endMs: number;
  card: CardType;
  slots: Record<string, unknown>;
}
interface LocalPlan {
  shots: LocalShot[];
}

interface FilmPlanMeta {
  mode: string;
  visualStyle: 'card' | 'illustration';
  aspect: '16:9' | '9:16';
  totalMs: number;
}

const CARD_LABELS: Record<CardType, string> = {
  statement: '陈述', stat: '数据', contrast: '对照', list: '清单',
};

/**
 * 字数/条数上限——与 `src/lib/video-production/shot-plan.ts` 内 `SLOTS` 保持
 * 一致。该文件的 `SLOTS` 是模块私有常量(未导出), 这里按同一份契约手抄一份;
 * **改任何一处上限都要同步改这里**, 否则前端红字提示与服务端 400 的实际
 * 拒绝阈值会悄悄分岔。
 */
const SLOT_LIMITS = {
  statement: { text: 24, sub: 20 },
  stat: { label: 16, prefix: 6, suffix: 6, note: 24 },
  contrast: { leftLabel: 12, leftText: 16, rightLabel: 12, rightText: 16 },
  list: { title: 16, item: 20, minItems: 3, maxItems: 8 },
} as const;

/** 出镜链间隙下限(毫秒)——与 `film-plan-timing.ts` 的 `BROLL_MIN_GAP_MS` 一致。
 * 同样是手抄的服务端阈值, 理由同上; 这里只用它做"保存前提醒", 真正把关的是
 * 服务端 `checkBrollPlanTiming`。 */
const BROLL_MIN_GAP_MS = 1000;

function blankSlots(card: CardType): Record<string, unknown> {
  switch (card) {
    case 'statement': return { text: '', sub: '' };
    case 'stat': return { label: '', value: 0, prefix: '', suffix: '', note: '' };
    case 'contrast': return { leftLabel: '', leftText: '', rightLabel: '', rightText: '' };
    case 'list': return { title: '', items: ['', '', ''] };
    default: return {};
  }
}

/** 换卡前要不要弹确认——原槽位已经写了东西才问, 空槽位直接换。 */
function slotHasContent(card: CardType, slots: Record<string, unknown>): boolean {
  if (card === 'list') {
    const items = Array.isArray(slots.items) ? (slots.items as unknown[]) : [];
    return Boolean(slots.title) || items.some((it) => typeof it === 'string' && it.trim() !== '');
  }
  return Object.entries(slots).some(([key, v]) => {
    if (key === 'value') return typeof v === 'number' && v !== 0;
    return typeof v === 'string' && v.trim() !== '';
  });
}

/**
 * 超字数的槽位字段——用于即时红字。**上限即 schema 上限**, 不是另定一套更松的
 * 前端提示阈值, 否则会出现"前端说能存、点保存却被服务端拒"的落差。
 */
function overflowFields(card: CardType, slots: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof slots[k] === 'string' ? (slots[k] as string) : '');
  const out: string[] = [];
  if (card === 'statement') {
    if (s('text').length > SLOT_LIMITS.statement.text) out.push(`text（${SLOT_LIMITS.statement.text} 字）`);
    if (s('sub').length > SLOT_LIMITS.statement.sub) out.push(`sub（${SLOT_LIMITS.statement.sub} 字）`);
  } else if (card === 'stat') {
    if (s('label').length > SLOT_LIMITS.stat.label) out.push(`label（${SLOT_LIMITS.stat.label} 字）`);
    if (s('prefix').length > SLOT_LIMITS.stat.prefix) out.push(`prefix（${SLOT_LIMITS.stat.prefix} 字）`);
    if (s('suffix').length > SLOT_LIMITS.stat.suffix) out.push(`suffix（${SLOT_LIMITS.stat.suffix} 字）`);
    if (s('note').length > SLOT_LIMITS.stat.note) out.push(`note（${SLOT_LIMITS.stat.note} 字）`);
  } else if (card === 'contrast') {
    if (s('leftLabel').length > SLOT_LIMITS.contrast.leftLabel) out.push(`leftLabel（${SLOT_LIMITS.contrast.leftLabel} 字）`);
    if (s('leftText').length > SLOT_LIMITS.contrast.leftText) out.push(`leftText（${SLOT_LIMITS.contrast.leftText} 字）`);
    if (s('rightLabel').length > SLOT_LIMITS.contrast.rightLabel) out.push(`rightLabel（${SLOT_LIMITS.contrast.rightLabel} 字）`);
    if (s('rightText').length > SLOT_LIMITS.contrast.rightText) out.push(`rightText（${SLOT_LIMITS.contrast.rightText} 字）`);
  } else if (card === 'list') {
    if (s('title').length > SLOT_LIMITS.list.title) out.push(`title（${SLOT_LIMITS.list.title} 字）`);
    const items = Array.isArray(slots.items) ? (slots.items as string[]) : [];
    items.forEach((it, i) => {
      if (typeof it === 'string' && it.length > SLOT_LIMITS.list.item) {
        out.push(`items[${i}]（${SLOT_LIMITS.list.item} 字）`);
      }
    });
    if (items.length < SLOT_LIMITS.list.minItems) out.push(`items（至少 ${SLOT_LIMITS.list.minItems} 条）`);
    if (items.length > SLOT_LIMITS.list.maxItems) out.push(`items（最多 ${SLOT_LIMITS.list.maxItems} 条）`);
  }
  return out;
}

/**
 * zod 结构错误(如 `shots.0.slots.value: Expected number, received string`)转
 * 成人话——服务端与模型修复循环共用的是同一套原文, 面向剪辑台用户还需要一层
 * 轻量转译(Task 2 复审遗留)。**只覆盖两类高频消息**(数字类型错、未知字段),
 * 其余原样展示——不是要重写 zod 全部报错文案, 是让最常见的两类不再是英文。
 *
 * 时间轴错误(`film-plan-timing.ts` 产出)本来就是中文整句, 不匹配下面的
 * `shots\.(\d+)` 前缀, 原样返回。
 */
function translateError(raw: string): string {
  const m = raw.match(/^shots\.(\d+)(?:\.(.+))?: (.+)$/);
  if (!m) return raw;
  const shotLabel = `第 ${Number(m[1]) + 1} 镜`;
  const fieldPath = m[2];
  const lastField = fieldPath ? fieldPath.split('.').pop() : '';
  const msg = m[3];
  let translated = msg;
  if (/^Expected number/.test(msg)) translated = '需要填数字';
  else if (/^Unrecognized key/i.test(msg)) translated = '含未知字段';
  const label = lastField ? `${shotLabel} · ${lastField}` : shotLabel;
  return `${label}：${translated}`;
}

function msToSec(ms: number): number {
  return Math.round((ms / 1000) * 100) / 100;
}
function secToMs(sec: number): number {
  return Math.round(sec * 1000);
}

export function FilmPlanWorkbench({
  productionId,
  onStatusChange,
}: {
  productionId: string;
  /** 确认渲染/重新生成成功后, 让 `film-detail.tsx` 把 `film.status` 一起换掉——
   * 剪辑台本身在那之后就不再出现(挂载条件是 `status === 'plan_ready'`)。 */
  onStatusChange: (status: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [meta, setMeta] = useState<FilmPlanMeta | null>(null);
  const [plan, setPlan] = useState<LocalPlan | null>(null);
  const [savedPlan, setSavedPlan] = useState<LocalPlan | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [saveCounter, setSaveCounter] = useState(0);
  const [busy, setBusy] = useState('');
  const [putErrors, setPutErrors] = useState<string[]>([]);
  const [conflictMsg, setConflictMsg] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingCardSwitch, setPendingCardSwitch] = useState<{ shotIndex: number; newCard: CardType } | null>(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const res = await fetch(`/api/v1/cockpit/video-productions/${productionId}/film-plan`);
        const body = await res.json();
        if (!res.ok || !body?.success) {
          if (!cancelled) setLoadError(body?.message ?? '加载分镜方案失败');
          return;
        }
        if (cancelled) return;
        const d = body.data;
        setMeta({ mode: d.mode, visualStyle: d.visualStyle, aspect: d.aspect, totalMs: d.totalMs });
        const p = (d.filmPlan ?? { shots: [] }) as LocalPlan;
        setPlan(p);
        setSavedPlan(p);
        setSelected(p.shots.length > 0 ? 0 : null);
      } catch {
        if (!cancelled) setLoadError('加载分镜方案失败，请检查网络');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productionId]);

  const dirty = useMemo(
    () => JSON.stringify(plan) !== JSON.stringify(savedPlan),
    [plan, savedPlan],
  );

  // 出镜链(talking-head-broll)是"真人全程铺底"的例外语义——镜间空档合法, 拖柄
  // 互相独立、不联动; 其余两条链要求整片铺满, 相邻镜头共享同一条边界。
  // GET 目前不下发 layout(pip/cutaway), 这里对两种 layout 一视同仁按 cutaway
  // 处理——已知的简化, 见任务报告。
  const isBroll = meta?.mode === 'talking-head-broll';

  function updateStart(idx: number, sec: number) {
    const ms = secToMs(sec);
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      shots[idx] = { ...shots[idx], startMs: ms };
      if (!isBroll && idx > 0) shots[idx - 1] = { ...shots[idx - 1], endMs: ms };
      return { ...prev, shots };
    });
  }
  function updateEnd(idx: number, sec: number) {
    const ms = secToMs(sec);
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      shots[idx] = { ...shots[idx], endMs: ms };
      if (!isBroll && idx < shots.length - 1) shots[idx + 1] = { ...shots[idx + 1], startMs: ms };
      return { ...prev, shots };
    });
  }

  function updateSlot(idx: number, key: string, value: unknown) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      shots[idx] = { ...shots[idx], slots: { ...shots[idx].slots, [key]: value } };
      return { ...prev, shots };
    });
  }

  function requestCardSwitch(idx: number, newCard: CardType) {
    if (!plan) return;
    const shot = plan.shots[idx];
    if (newCard === shot.card) return;
    if (slotHasContent(shot.card, shot.slots)) {
      setPendingCardSwitch({ shotIndex: idx, newCard });
    } else {
      applyCardSwitch(idx, newCard);
    }
  }
  function applyCardSwitch(idx: number, newCard: CardType) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      shots[idx] = { ...shots[idx], card: newCard, slots: blankSlots(newCard) };
      return { ...prev, shots };
    });
    setPendingCardSwitch(null);
  }

  // 出镜链的间隙即时提示——复用后端 `checkBrollPlanTiming` 的判定规则(间隙要么
  // 是 0, 要么至少 1 秒), 别让用户保存了才发现。
  const gapWarnings = useMemo(() => {
    if (!plan || !isBroll) return [];
    const sorted = [...plan.shots].sort((a, b) => a.startMs - b.startMs);
    const warnings: string[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].startMs - sorted[i - 1].endMs;
      if (gap > 0 && gap < BROLL_MIN_GAP_MS) {
        warnings.push(
          `镜头 ${sorted[i - 1].shotId} 到镜头 ${sorted[i].shotId} 之间只间隔 ${gap} 毫秒, `
          + `太短会像镜头故障——间隙要么合并为 0, 要么至少留 ${BROLL_MIN_GAP_MS} 毫秒。`,
        );
      }
    }
    return warnings;
  }, [plan, isBroll]);

  async function save() {
    if (!plan) return;
    setBusy('save');
    setPutErrors([]);
    setConflictMsg('');
    setSaveNote('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${productionId}/film-plan`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json();
      if (res.status === 409) {
        setConflictMsg(body?.message ?? '任务状态刚刚变化，请刷新后重试');
        return;
      }
      if (!res.ok || !body?.success) {
        const raw: string[] = Array.isArray(body?.errors) ? body.errors : [];
        setPutErrors(raw.length > 0 ? raw.map(translateError) : [body?.message ?? '保存失败']);
        return;
      }
      const saved = body.data.filmPlan as LocalPlan;
      setPlan(saved);
      setSavedPlan(saved);
      // 缩略图接口按内容哈希缓存, 方案变了但 URL 不变——用保存计数器给 img src
      // 加查询参数破缓存, 否则保存后卡面看起来"没变"。
      setSaveCounter((c) => c + 1);
      setSaveNote('已保存，缩略图已刷新。');
      router.refresh();
    } catch {
      setPutErrors(['保存失败，请检查网络']);
    } finally {
      setBusy('');
    }
  }

  async function confirmRender() {
    setBusy('render');
    setActionError('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${productionId}/render`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setActionError(body?.message ?? '操作失败');
        return;
      }
      onStatusChange(body.data?.status ?? 'queued');
      router.refresh();
    } catch {
      setActionError('操作失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  async function regenerate() {
    setBusy('start');
    setActionError('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${productionId}/start`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setActionError(body?.message ?? '操作失败');
        return;
      }
      onStatusChange(body.data?.status ?? 'queued');
      router.refresh();
    } catch {
      setActionError('操作失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return (
      <section className="mt-2 rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
        正在加载分镜方案…
      </section>
    );
  }
  if (loadError) {
    return (
      <section className="mt-2 rounded-md border border-destructive/50 bg-destructive/5 p-4 text-xs text-destructive">
        {loadError}
      </section>
    );
  }
  if (!plan || !meta) return null;

  const shot = selected !== null ? plan.shots[selected] : null;

  return (
    <section className="rounded-md border border-border bg-card p-4" data-testid="film-plan-workbench">
      <h2 className="text-base font-semibold">剪辑台</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        分镜待确认——逐镜调整文字、卡片和时长, 满意了再点「确认并开始渲染」。
      </p>

      {/* 横向缩略图条 —— 17 镜全量出图实测热渲染 0.6s, 不需要懒加载。 */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {plan.shots.map((s, idx) => (
          <button
            key={s.shotId}
            type="button"
            onClick={() => setSelected(idx)}
            className={cn(
              'flex shrink-0 flex-col items-center gap-1 rounded-md border p-1.5 text-xs',
              selected === idx ? 'border-foreground/70 bg-secondary/60' : 'border-border hover:border-foreground/30',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 服务端裁的 PNG, 无需 next/image 优化 */}
            <img
              src={`/api/v1/cockpit/video-productions/${productionId}/shot-still/${idx}?v=${saveCounter}`}
              alt={`第 ${idx + 1} 镜`}
              className="h-24 w-auto rounded border border-border bg-background"
            />
            <span className="font-medium">
              {`${idx + 1} · ${CARD_LABELS[s.card]}`}
            </span>
            <span className="text-muted-foreground">{`${((s.endMs - s.startMs) / 1000).toFixed(1)}s`}</span>
          </button>
        ))}
      </div>

      {/* 编辑抽屉——不用 modal, 单页纵向下就地展开在缩略图条下方。 */}
      {shot && selected !== null ? (
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">第 {selected + 1} 镜</span>
            <label className="flex items-center gap-1 text-xs">
              卡类型
              <select
                value={shot.card}
                onChange={(e) => requestCardSwitch(selected, e.target.value as CardType)}
                className="rounded border border-input bg-card px-2 py-1"
              >
                {CARD_TYPES.map((c) => (
                  <option key={c} value={c}>{CARD_LABELS[c]}</option>
                ))}
              </select>
            </label>
          </div>

          {pendingCardSwitch && pendingCardSwitch.shotIndex === selected ? (
            <div className="mt-2 rounded border border-destructive/50 bg-destructive/5 p-2 text-xs">
              <p>
                换卡会清空这一镜已经填写的内容——
                {`即将换成「${CARD_LABELS[pendingCardSwitch.newCard]}」`}，确定吗？
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => applyCardSwitch(selected, pendingCardSwitch.newCard)}>
                  确定换卡
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingCardSwitch(null)}>取消</Button>
              </div>
            </div>
          ) : null}

          {/* 槽位表单——按卡类型动态出字段 */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SlotFields
              card={shot.card}
              slots={shot.slots}
              onChange={(key, value) => updateSlot(selected, key, value)}
            />
          </div>

          {/* 时间窗——数字输入是必须, 拖拽是加分(本次只做数字输入, 见任务报告)。 */}
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3 text-xs">
            <label className="flex flex-col gap-1">
              起始（秒）
              <input
                type="number"
                step="0.1"
                value={msToSec(shot.startMs)}
                disabled={!isBroll && selected === 0}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (!Number.isNaN(v)) updateStart(selected, v);
                }}
                className="w-24 rounded border border-input bg-card px-2 py-1 disabled:opacity-50"
              />
            </label>
            <label className="flex flex-col gap-1">
              结束（秒）
              <input
                type="number"
                step="0.1"
                value={msToSec(shot.endMs)}
                disabled={!isBroll && selected === plan.shots.length - 1}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (!Number.isNaN(v)) updateEnd(selected, v);
                }}
                className="w-24 rounded border border-input bg-card px-2 py-1 disabled:opacity-50"
              />
            </label>
            {!isBroll ? (
              <span className="text-muted-foreground">
                总时长锁定为 {(meta.totalMs / 1000).toFixed(1)}s——相邻两镜共用一条边界, 拖一边另一边跟着动,
                天然铺满不留空档。
              </span>
            ) : (
              <span className="text-muted-foreground">
                出镜画面全程有真人铺底, 镜间可以留空档(≥1 秒)——拖柄互相独立。
              </span>
            )}
          </div>
        </div>
      ) : null}

      {gapWarnings.length > 0 ? (
        <div className="mt-3 rounded border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
          {gapWarnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      ) : null}

      {putErrors.length > 0 ? (
        <div className="mt-3 rounded border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
          {putErrors.map((e) => <p key={e}>{e}</p>)}
        </div>
      ) : null}
      {conflictMsg ? (
        <p className="mt-2 text-xs text-destructive">{conflictMsg}</p>
      ) : null}
      {saveNote ? <p className="mt-2 text-xs text-muted-foreground">{saveNote}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button disabled={busy !== '' || !dirty} onClick={() => void save()}>
          {busy === 'save' ? '保存中…' : '保存修改'}
        </Button>

        <Button
          variant="outline"
          disabled={busy !== '' || dirty}
          onClick={() => void confirmRender()}
        >
          {busy === 'render' ? '提交中…' : '确认并开始渲染'}
        </Button>
        {dirty ? <span className="text-xs text-muted-foreground">有未保存的修改, 先保存才能渲染。</span> : null}

        {!showRegenerateConfirm ? (
          <Button variant="ghost" disabled={busy !== ''} onClick={() => setShowRegenerateConfirm(true)}>
            重新生成分镜
          </Button>
        ) : (
          <span className="rounded border border-destructive/50 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
            当前修改会被覆盖——重新生成会用全新分镜覆盖你在这里做的所有修改, 且无法恢复。
            <Button size="sm" variant="destructive" className="ml-2" onClick={() => { setShowRegenerateConfirm(false); void regenerate(); }}>
              确定重新生成
            </Button>
            <Button size="sm" variant="outline" className="ml-1" onClick={() => setShowRegenerateConfirm(false)}>
              取消
            </Button>
          </span>
        )}
      </div>
      {actionError ? <p className="mt-2 text-xs text-destructive">{actionError}</p> : null}
    </section>
  );
}

/**
 * 单个文本槽位输入框——**独立顶层组件, 不嵌在 `SlotFields` 内部定义**。
 *
 * 早先把它写成 `SlotFields` 函数体内的一个内嵌函数, 每次 `SlotFields` 渲染都会
 * 产出一个新的函数引用, React 按"组件类型变了"处理, 整个 `<TextField>` 子树被
 * 卸载重挂——受控输入框的 DOM 节点因此在每次输入后都被换成新节点。真机上不
 * 影响正确性(下一帧还是能读到对的值), 但测试里持有的是旧节点引用, 断言读到
 * 的永远是换字之前那一份 `className`, 看起来像"红字没生效"。提到顶层、把
 * `overflow`/`value` 都作为 props 传入, 组件类型跨渲染保持稳定, 输入框 DOM
 * 节点也保持稳定。
 */
function TextField({
  field, label, limit, value, bad, optional, onChange,
}: {
  field: string;
  label: string;
  limit: number;
  value: string;
  bad: boolean;
  optional?: boolean;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}{optional ? '（可选）' : ''}
      <input
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className={cn('rounded border bg-card px-2 py-1', bad ? 'border-destructive' : 'border-input')}
      />
      <span className={cn(bad ? 'text-destructive' : 'text-muted-foreground')}>
        {`${value.length}/${limit}`}
      </span>
    </label>
  );
}

/** 按卡类型动态出字段——四种卡各自的槽位表单。 */
function SlotFields({
  card, slots, onChange,
}: {
  card: CardType;
  slots: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const overflow = overflowFields(card, slots);
  const isBad = (field: string) => overflow.some((o) => o.startsWith(`${field}（`));
  const str = (k: string) => (typeof slots[k] === 'string' ? (slots[k] as string) : '');
  const num = (k: string) => (typeof slots[k] === 'number' ? (slots[k] as number) : 0);

  if (card === 'statement') {
    return (
      <>
        <TextField field="text" label="text" limit={SLOT_LIMITS.statement.text} value={str('text')} bad={isBad('text')} onChange={onChange} />
        <TextField field="sub" label="sub" limit={SLOT_LIMITS.statement.sub} value={str('sub')} bad={isBad('sub')} optional onChange={onChange} />
      </>
    );
  }
  if (card === 'stat') {
    return (
      <>
        <TextField field="label" label="label" limit={SLOT_LIMITS.stat.label} value={str('label')} bad={isBad('label')} onChange={onChange} />
        <label className="flex flex-col gap-1 text-xs">
          value（裸数字）
          <input
            type="number"
            value={num('value')}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              onChange('value', Number.isNaN(v) ? 0 : v);
            }}
            className="rounded border border-input bg-card px-2 py-1"
          />
        </label>
        <TextField field="prefix" label="prefix" limit={SLOT_LIMITS.stat.prefix} value={str('prefix')} bad={isBad('prefix')} optional onChange={onChange} />
        <TextField field="suffix" label="suffix" limit={SLOT_LIMITS.stat.suffix} value={str('suffix')} bad={isBad('suffix')} optional onChange={onChange} />
        <TextField field="note" label="note" limit={SLOT_LIMITS.stat.note} value={str('note')} bad={isBad('note')} optional onChange={onChange} />
      </>
    );
  }
  if (card === 'contrast') {
    return (
      <>
        <TextField field="leftLabel" label="leftLabel" limit={SLOT_LIMITS.contrast.leftLabel} value={str('leftLabel')} bad={isBad('leftLabel')} onChange={onChange} />
        <TextField field="leftText" label="leftText" limit={SLOT_LIMITS.contrast.leftText} value={str('leftText')} bad={isBad('leftText')} onChange={onChange} />
        <TextField field="rightLabel" label="rightLabel" limit={SLOT_LIMITS.contrast.rightLabel} value={str('rightLabel')} bad={isBad('rightLabel')} onChange={onChange} />
        <TextField field="rightText" label="rightText" limit={SLOT_LIMITS.contrast.rightText} value={str('rightText')} bad={isBad('rightText')} onChange={onChange} />
      </>
    );
  }
  // list
  const items = Array.isArray(slots.items) ? (slots.items as string[]) : [];
  return (
    <>
      <TextField field="title" label="title" limit={SLOT_LIMITS.list.title} value={str('title')} bad={isBad('title')} onChange={onChange} />
      <div className="flex flex-col gap-1 text-xs sm:col-span-2">
        {`条目（${SLOT_LIMITS.list.minItems}~${SLOT_LIMITS.list.maxItems} 条）`}
        {items.map((it, i) => {
          const bad = it.length > SLOT_LIMITS.list.item;
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                value={it}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange('items', next);
                }}
                className={cn('flex-1 rounded border bg-card px-2 py-1', bad ? 'border-destructive' : 'border-input')}
              />
              <span className={cn(bad ? 'text-destructive' : 'text-muted-foreground')}>{`${it.length}/${SLOT_LIMITS.list.item}`}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={items.length <= SLOT_LIMITS.list.minItems}
                onClick={() => onChange('items', items.filter((_, j) => j !== i))}
              >
                删除
              </Button>
            </div>
          );
        })}
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={items.length >= SLOT_LIMITS.list.maxItems}
          onClick={() => onChange('items', [...items, ''])}
        >
          加一条
        </Button>
      </div>
    </>
  );
}
