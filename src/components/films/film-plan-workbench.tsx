'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CARD_TYPES, type CardType, type FilmPlan } from '@/lib/video-production/shot-plan';
import {
  checkFilmPlanTimingWindowed, BROLL_MIN_SHOT_MS, BROLL_MIN_GAP_MS,
} from '@/lib/video-production/film-plan-timing';
import { SHOT_STYLE_CONTROLS } from '@/lib/video-production/card-controls';
import { PlanPreview, type PreviewPlan } from '@/components/films/plan-preview';

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
 *
 * **pip 分流(复审补, 三十一期 Task 4 一轮修复)**: `talking-head-broll` 下有两种
 * 版式, 时间窗语义完全不同——cutaway(真人全程铺底, 卡片窗口之外是正常露脸,
 * 空档合法) vs pip(真人缩进小窗常驻, 卡片是主画面, 按**每一幕的时间窗**分别
 * 铺满、幕与幕之间的天然间隙才不算问题)。首版没有 `layout` 字段, 对两种版式
 * 一视同仁按 cutaway 处理——这是真实风险(pip 用户会被 cutaway 的"间隙<1s"提示
 * 误导, 也看不到"这一幕没铺满"的真正问题)。GET 现在下发 `layout`, 前端按它
 * 分流: 两种版式的拖柄都保持独立(不像非出镜链那样联动边界), 但 pip 额外套用
 * `checkFilmPlanTimingWindowed`(与服务端窗口校验**同一个函数**, 而不是照抄一份
 * 等价逻辑——这条判定规则只应该存在一处, 否则前端提示和服务端拒绝迟早对不上)。
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
  /** 画面参数覆盖(三十二期 Task 5)——与 `SHOT_STYLE_CONTROLS`/`ShotStyleSchema`
   * 逐字段同形, 用户在这里改的值直接写进方案, PUT 时随 `plan` 一起落盘, API 不用改。 */
  style?: { speed?: number; accent?: 'default' | 'blue' | 'yellow' | 'red'; scale?: number };
}
interface LocalPlan {
  shots: LocalShot[];
}

interface FilmPlanMeta {
  mode: string;
  visualStyle: 'card' | 'illustration';
  aspect: '16:9' | '9:16';
  totalMs: number;
  /** talking-head-broll 专属, 其余两条链为 null——见组件顶部"pip 分流"说明。 */
  layout: 'cutaway' | 'pip' | null;
  /** 幕边界原样透传, pip 窗口校验按它分组——形状与服务端 `AlignedAct` 一致,
   * 这里不为了一份只读一次的数据额外定一份严格类型。 */
  alignedActs: unknown;
}

const CARD_LABELS: Record<CardType, string> = {
  statement: '陈述', stat: '数据', contrast: '对照', list: '清单',
};

/**
 * 字数上下限——与 `src/lib/video-production/shot-plan.ts` 内 `SLOTS` 保持一致
 * (`min`=必填字段的下限, 均为 1; 可选字段 `min`=0)。该文件的 `SLOTS` 是模块私有
 * 常量(未导出), 这里按同一份契约手抄一份; **改任何一处上下限都要同步改这里**,
 * 否则前端红字提示与服务端 400 的实际拒绝阈值会悄悄分岔。
 */
const SLOT_LIMITS = {
  statement: { text: { min: 1, max: 24 }, sub: { min: 0, max: 20 } },
  stat: {
    label: { min: 1, max: 16 },
    prefix: { min: 0, max: 6 },
    suffix: { min: 0, max: 6 },
    note: { min: 0, max: 24 },
  },
  contrast: {
    leftLabel: { min: 1, max: 12 },
    leftText: { min: 1, max: 16 },
    rightLabel: { min: 1, max: 12 },
    rightText: { min: 1, max: 16 },
  },
  list: {
    title: { min: 1, max: 16 },
    item: { min: 1, max: 20 },
    minItems: 3,
    maxItems: 8,
  },
} as const;

/** 相邻联动/独立拖柄共用的镜长软下限——与 `film-plan-timing.ts` 导出的
 * `BROLL_MIN_SHOT_MS`(=1200ms)是**同一个常量**(那里已导出, 直接 import, 不再
 * 手抄一份数值)。用途: 联动改边界时 clamp, 不让非法值(负时长/短于下限)在
 * 输入层就产生, 而不是等保存才被服务端 400。 */
const MIN_SHOT_MS = BROLL_MIN_SHOT_MS;

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
 * 某一镜必填字段里还空着的——保存前本地检查用(复审补)。**只查必填(`min`>0)**,
 * 不查超长(超长在 `TextField`/条目输入框里已经即时红字, 不必在保存前再拦一次)。
 * 返回字段名(如 `leftLabel`/`items[2]`), 由调用方拼成"第 N 镜 · 字段：必填"。
 */
function missingFieldsOfShot(shot: LocalShot): string[] {
  const slots = shot.slots;
  const str = (k: string) => (typeof slots[k] === 'string' ? (slots[k] as string) : '');
  const missing: string[] = [];
  if (shot.card === 'statement') {
    if (str('text').length < SLOT_LIMITS.statement.text.min) missing.push('text');
  } else if (shot.card === 'stat') {
    if (str('label').length < SLOT_LIMITS.stat.label.min) missing.push('label');
  } else if (shot.card === 'contrast') {
    (['leftLabel', 'leftText', 'rightLabel', 'rightText'] as const).forEach((k) => {
      if (str(k).length < SLOT_LIMITS.contrast[k].min) missing.push(k);
    });
  } else if (shot.card === 'list') {
    if (str('title').length < SLOT_LIMITS.list.title.min) missing.push('title');
    const items = Array.isArray(slots.items) ? (slots.items as string[]) : [];
    items.forEach((it, i) => {
      if (typeof it !== 'string' || it.length < SLOT_LIMITS.list.item.min) missing.push(`items[${i}]`);
    });
  }
  return missing;
}

/**
 * zod 结构错误(如 `shots.0.slots.value: Expected number, received string`)转
 * 成人话——服务端与模型修复循环共用的是同一套原文, 面向剪辑台用户还需要一层
 * 轻量转译(Task 2 复审遗留)。**只覆盖三类高频消息**(数字类型错、未知字段、
 * 必填字符串为空), 其余原样展示——不是要重写 zod 全部报错文案, 是让最常见的
 * 几类不再是英文。
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
  else if (/^String must contain at least 1 character/.test(msg)) translated = '必填';
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
  /** 预览双模(三十二期 Task 5)——单镜默认: 打开剪辑台第一时间就想看当前选中
   * 这一镜的效果, 整片是核对全局节奏时才切过去的进阶操作。 */
  const [previewMode, setPreviewMode] = useState<'shot' | 'film'>('shot');

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
        setMeta({
          mode: d.mode,
          visualStyle: d.visualStyle,
          aspect: d.aspect,
          totalMs: d.totalMs,
          layout: d.layout === 'pip' || d.layout === 'cutaway' ? d.layout : null,
          alignedActs: d.alignedActs,
        });
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

  // 出镜链(talking-head-broll)两种版式(cutaway/pip)拖柄都互相独立、不联动——
  // 差异只在"要不要额外套用窗口铺满校验"(见下面 pipWindowWarnings), 不影响
  // 拖柄是否联动这件事。其余两条链要求整片铺满, 相邻镜头共享同一条边界。
  const isBroll = meta?.mode === 'talking-head-broll';

  function updateStart(idx: number, sec: number) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      let ms = secToMs(sec);
      // 防止本镜被拖成负时长/短于软下限
      ms = Math.min(ms, shots[idx].endMs - MIN_SHOT_MS);
      if (!isBroll && idx > 0) {
        // 联动会把这个值同时写成上一镜的 endMs——同样不能把上一镜挤短于软下限
        ms = Math.max(ms, shots[idx - 1].startMs + MIN_SHOT_MS);
      }
      shots[idx] = { ...shots[idx], startMs: ms };
      if (!isBroll && idx > 0) shots[idx - 1] = { ...shots[idx - 1], endMs: ms };
      return { ...prev, shots };
    });
  }
  function updateEnd(idx: number, sec: number) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      let ms = secToMs(sec);
      ms = Math.max(ms, shots[idx].startMs + MIN_SHOT_MS);
      if (!isBroll && idx < shots.length - 1) {
        ms = Math.min(ms, shots[idx + 1].endMs - MIN_SHOT_MS);
      }
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

  /** 画面参数改动(三十二期 Task 5)——写进本地 `plan`, `PlanPreview` 下一次渲染
   * 就会用新值(props 变化触发 React 重渲, 不需要额外的手动刷新)。 */
  function updateStyle(idx: number, key: string, value: unknown) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      const style = { ...(shots[idx].style ?? {}), [key]: value };
      shots[idx] = { ...shots[idx], style };
      return { ...prev, shots };
    });
  }

  /** 「恢复默认」——把这个字段从 style 里删掉, 不是写回一个"默认值"。
   * 删掉字段与"卡片组件读不到这个 key 时用的缺省值"是同一件事(见
   * `remotion/src/cards/style.ts` 的 `speedT`/`resolveAccent`/`scaleStyle`
   * 都是 `style?.xxx ?? 默认值`), 比反查一遍默认值再写回去更不容易两边失配。
   * 字段清空后如果 style 变成空对象, 一并把 `style` 整个字段也删掉——避免
   * PUT 时方案里留一堆 `style: {}` 的死字段。 */
  function resetStyleField(idx: number, key: string) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = [...prev.shots];
      const nextStyle = { ...(shots[idx].style ?? {}) } as Record<string, unknown>;
      delete nextStyle[key];
      const hasAny = Object.keys(nextStyle).length > 0;
      const { style: _drop, ...rest } = shots[idx];
      shots[idx] = hasAny ? { ...rest, style: nextStyle } : rest;
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

  // cutaway 的间隙即时提示——复用后端 `checkBrollPlanTiming` 的判定规则(间隙要么
  // 是 0, 要么至少 1 秒), 别让用户保存了才发现。**只对 cutaway 生效**——pip 的
  // 时间窗语义是"按幕铺满", 不是"间隙够不够长", 套错规则会在 pip 上误导用户。
  const gapWarnings = useMemo(() => {
    if (!plan || meta?.layout !== 'cutaway') return [];
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
  }, [plan, meta]);

  /**
   * pip 的按幕窗口铺满提示——**直接复用服务端 `checkFilmPlanTimingWindowed`**,
   * 不是照它的逻辑另写一份。`windows` 的推导(过滤零时长幕、取 startMs/endMs)
   * 与 `film-plan/route.ts` 的 `nonZeroAlignedWindows` 是同一件事, 这里数据源
   * 是 GET 已经原样透传的 `alignedActs`, 直接在组件内联过滤——只是取字段, 没有
   * 值得抽成共享函数的判定逻辑(真正的判定逻辑都在 `checkFilmPlanTimingWindowed`
   * 里, 已经共享)。
   */
  const pipWindowWarnings = useMemo(() => {
    if (!plan || meta?.layout !== 'pip') return [];
    const raw = Array.isArray(meta.alignedActs)
      ? (meta.alignedActs as { startMs?: unknown; endMs?: unknown }[])
      : [];
    const windows = raw
      .filter((w): w is { startMs: number; endMs: number } => (
        typeof w.startMs === 'number' && typeof w.endMs === 'number' && w.endMs > w.startMs
      ))
      .map((w) => ({ startMs: w.startMs, endMs: w.endMs }));
    return checkFilmPlanTimingWindowed(plan as unknown as FilmPlan, windows);
  }, [plan, meta]);

  async function save() {
    if (!plan) return;
    setConflictMsg('');
    setSaveNote('');

    // 保存前本地先查必填(复审补)——空着的字段就地提示, 不发请求。**不禁用
    // 保存按钮**(禁用会让用户找不到为什么点不动), 点了才检查、检查不过才拦。
    const localIssues: string[] = [];
    plan.shots.forEach((shot, idx) => {
      missingFieldsOfShot(shot).forEach((field) => {
        localIssues.push(`第 ${idx + 1} 镜 · ${field}：必填`);
      });
    });
    if (localIssues.length > 0) {
      setPutErrors(localIssues);
      return;
    }

    setBusy('save');
    setPutErrors([]);
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
      // 加查询参数破缓存, 否则保存后卡面看起来"没变"。**只在真正保存成功时才
      // 自增**——409/400 都提前 return, 不会走到这里; 缩略图内容并没有变,
      // 破缓存反而会让用户看见一次不必要的重新请求。
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

      {/* 预览区(三十二期 Task 5)——单镜/整片双模, 选中镜或参数改动会立刻反映在这里。 */}
      {plan.shots.length > 0 ? (
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">预览</span>
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setPreviewMode('shot')}
                className={cn(
                  'rounded border px-2 py-1',
                  previewMode === 'shot' ? 'border-foreground/70 bg-secondary/60' : 'border-border hover:border-foreground/30',
                )}
              >
                单镜
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('film')}
                className={cn(
                  'rounded border px-2 py-1',
                  previewMode === 'film' ? 'border-foreground/70 bg-secondary/60' : 'border-border hover:border-foreground/30',
                )}
              >
                整片
              </button>
            </div>
          </div>
          <div className="mt-2">
            <PlanPreview
              mode={previewMode}
              plan={plan as PreviewPlan}
              selected={selected ?? 0}
              vpId={productionId}
              aspect={meta.aspect}
              visualStyle={meta.visualStyle}
            />
          </div>
        </div>
      ) : null}

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
            ) : meta.layout === 'pip' ? (
              <span className="text-muted-foreground">
                卡片是主画面, 真人缩进小窗常驻——拖柄互相独立, 但每一幕的时间窗内仍要铺满
                (幕与幕之间的天然间隙不算问题, 见下方提示)。
              </span>
            ) : (
              <span className="text-muted-foreground">
                出镜画面全程有真人铺底, 镜间可以留空档(≥1 秒)——拖柄互相独立。
              </span>
            )}
          </div>

          {/* 画面参数面板(三十二期 Task 5)——遍历 SHOT_STYLE_CONTROLS 生成 UI,
              加新参数不用改这里的代码。改动写进本地 plan, 上方预览立刻用新值重渲染。 */}
          <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-border pt-3 text-xs">
            <StyleControls
              shot={shot}
              onChange={(key, value) => updateStyle(selected, key, value)}
              onReset={(key) => resetStyleField(selected, key)}
            />
          </div>
        </div>
      ) : null}

      {gapWarnings.length > 0 ? (
        <div className="mt-3 rounded border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
          {gapWarnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      ) : null}

      {/*
        pip 窗口提示用比错误红更缓和的语气(muted/secondary)——这条设计系统没有
        单独的"警告"色阶(见 `film-plan-workbench.tsx` 引入前对 tailwind 配置/
        globals.css 的检查, 没有 warning/amber token), 与其新引入一个只此一处
        用的裸颜色, 不如借用已有的 secondary 语气 + 文字上明说"提示"二字区分于
        上面的红色错误块。
      */}
      {pipWindowWarnings.length > 0 ? (
        <div className="mt-3 rounded border border-border bg-secondary/60 p-2 text-xs text-foreground">
          <p className="font-medium">提示——以下幕的时间窗没有铺满：</p>
          {pipWindowWarnings.map((w) => <p key={w}>{w}</p>)}
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
 * `min`/`max`/`value` 都作为 props 传入, 组件类型跨渲染保持稳定, 输入框 DOM
 * 节点也保持稳定。
 *
 * **必填/超长两种红字合并进同一个组件(复审补)**: `min > 0` 且当前值比它短 ——
 * 显示「必填」; 否则按原来的"已用字数/上限"显示, 超过上限时同样标红。两者
 * 共享同一套视觉(红框 + 红字), 不需要在调用点各算一遍。
 */
function TextField({
  field, label, min, max, value, optional, onChange,
}: {
  field: string;
  label: string;
  min: number;
  max: number;
  value: string;
  optional?: boolean;
  onChange: (field: string, value: string) => void;
}) {
  const missing = min > 0 && value.length < min;
  const overflow = value.length > max;
  const bad = missing || overflow;
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}{optional ? '（可选）' : ''}
      <input
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className={cn('rounded border bg-card px-2 py-1', bad ? 'border-destructive' : 'border-input')}
      />
      <span className={cn(bad ? 'text-destructive' : 'text-muted-foreground')}>
        {missing ? '必填' : `${value.length}/${max}`}
      </span>
    </label>
  );
}

/**
 * 画面参数面板(三十二期 Task 5)——遍历 `SHOT_STYLE_CONTROLS` 生成 range/select,
 * 加新参数不用改这个组件。控件的 label/取值范围完全由那份声明决定; 这里只负责
 * "当前值缺省时按卡片组件的实际默认值展示"(与 `remotion/src/cards/style.ts`
 * 的 `speedT`/`resolveAccent`/`scaleStyle` 缺省值逐条对齐, 否则面板显示的初始
 * 刻度和画面实际呈现的效果会对不上)。
 */
function StyleControls({
  shot, onChange, onReset,
}: {
  shot: LocalShot;
  onChange: (key: string, value: unknown) => void;
  /** 「恢复默认」——把这个字段从 style 里删掉, 回到卡片组件自身的缺省值。 */
  onReset: (key: string) => void;
}) {
  const style = shot.style ?? {};
  return (
    <>
      {SHOT_STYLE_CONTROLS.map((ctrl) => {
        // 是否已经被用户改过——决定「恢复默认」是否可点(没改过点了也没意义)。
        const isOverridden = (style as Record<string, unknown>)[ctrl.key] !== undefined;
        if (ctrl.type === 'range') {
          const fallback = ctrl.key === 'speed' || ctrl.key === 'scale' ? 1 : ctrl.min;
          const raw = (style as Record<string, unknown>)[ctrl.key];
          const value = typeof raw === 'number' ? raw : fallback;
          return (
            <div key={ctrl.key} className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                {`${ctrl.label}（${value}${ctrl.unit ?? ''}）`}
                <input
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  value={value}
                  onChange={(e) => onChange(ctrl.key, e.target.valueAsNumber)}
                  className="w-40"
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!isOverridden}
                onClick={() => onReset(ctrl.key)}
              >
                恢复默认
              </Button>
            </div>
          );
        }
        const raw = (style as Record<string, unknown>)[ctrl.key];
        const value = typeof raw === 'string' ? raw : ctrl.options[0].value;
        return (
          <div key={ctrl.key} className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              {ctrl.label}
              <select
                value={value}
                onChange={(e) => onChange(ctrl.key, e.target.value)}
                className="rounded border border-input bg-card px-2 py-1"
              >
                {ctrl.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!isOverridden}
              onClick={() => onReset(ctrl.key)}
            >
              恢复默认
            </Button>
          </div>
        );
      })}
    </>
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
  const str = (k: string) => (typeof slots[k] === 'string' ? (slots[k] as string) : '');
  const num = (k: string) => (typeof slots[k] === 'number' ? (slots[k] as number) : 0);

  if (card === 'statement') {
    return (
      <>
        <TextField field="text" label="text" min={SLOT_LIMITS.statement.text.min} max={SLOT_LIMITS.statement.text.max} value={str('text')} onChange={onChange} />
        <TextField field="sub" label="sub" min={SLOT_LIMITS.statement.sub.min} max={SLOT_LIMITS.statement.sub.max} value={str('sub')} optional onChange={onChange} />
      </>
    );
  }
  if (card === 'stat') {
    return (
      <>
        <TextField field="label" label="label" min={SLOT_LIMITS.stat.label.min} max={SLOT_LIMITS.stat.label.max} value={str('label')} onChange={onChange} />
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
        <TextField field="prefix" label="prefix" min={SLOT_LIMITS.stat.prefix.min} max={SLOT_LIMITS.stat.prefix.max} value={str('prefix')} optional onChange={onChange} />
        <TextField field="suffix" label="suffix" min={SLOT_LIMITS.stat.suffix.min} max={SLOT_LIMITS.stat.suffix.max} value={str('suffix')} optional onChange={onChange} />
        <TextField field="note" label="note" min={SLOT_LIMITS.stat.note.min} max={SLOT_LIMITS.stat.note.max} value={str('note')} optional onChange={onChange} />
      </>
    );
  }
  if (card === 'contrast') {
    return (
      <>
        <TextField field="leftLabel" label="leftLabel" min={SLOT_LIMITS.contrast.leftLabel.min} max={SLOT_LIMITS.contrast.leftLabel.max} value={str('leftLabel')} onChange={onChange} />
        <TextField field="leftText" label="leftText" min={SLOT_LIMITS.contrast.leftText.min} max={SLOT_LIMITS.contrast.leftText.max} value={str('leftText')} onChange={onChange} />
        <TextField field="rightLabel" label="rightLabel" min={SLOT_LIMITS.contrast.rightLabel.min} max={SLOT_LIMITS.contrast.rightLabel.max} value={str('rightLabel')} onChange={onChange} />
        <TextField field="rightText" label="rightText" min={SLOT_LIMITS.contrast.rightText.min} max={SLOT_LIMITS.contrast.rightText.max} value={str('rightText')} onChange={onChange} />
      </>
    );
  }
  // list
  const items = Array.isArray(slots.items) ? (slots.items as string[]) : [];
  return (
    <>
      <TextField field="title" label="title" min={SLOT_LIMITS.list.title.min} max={SLOT_LIMITS.list.title.max} value={str('title')} onChange={onChange} />
      <div className="flex flex-col gap-1 text-xs sm:col-span-2">
        {`条目（${SLOT_LIMITS.list.minItems}~${SLOT_LIMITS.list.maxItems} 条）`}
        {items.map((it, i) => {
          const missing = it.length < SLOT_LIMITS.list.item.min;
          const overflow = it.length > SLOT_LIMITS.list.item.max;
          const bad = missing || overflow;
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
              <span className={cn(bad ? 'text-destructive' : 'text-muted-foreground')}>
                {missing ? '必填' : `${it.length}/${SLOT_LIMITS.list.item.max}`}
              </span>
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
