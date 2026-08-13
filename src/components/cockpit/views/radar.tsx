"use client";

import { useCallback, useEffect, useState } from "react";
import type { NavView } from "@/lib/cockpit/view-routing";
import { pickPersonaBadge } from "@/lib/radar/persona-badge";
import { Empty } from "../shared";

/**
 * 「热点雷达」视图 — 四期 T6, spec §3。
 *
 * 与其余 cockpit 视图不同: 这个视图**自取数**，不消费/不写 `WorkspaceState`
 * (架构原则见 plan「Architecture」一节: "雷达为服务端域，视图自取数，学 dashboard
 * summary 先例，不进 WorkspaceState")。数据源是 T5 的四个 API
 * (`items`/`keywords`/`config`/`runs/latest`)，全部在挂载时并发拉取一次；
 * 没有做轮询/SSE —— 「立即扫描」只是把一次性 job 塞进队列，真正跑完是异步的，
 * 用户可以切走再切回来（重新挂载即重新拉取）看到最新结果，YAGNI 掉自动刷新。
 *
 * 三块布局（spec §3）:
 *   1. 候选关键词审批条 —— 只在存在 candidate 词时渲染。
 *   2. 热度排行 —— 卡片: 分数(悬浮 title 展开四维+共现) / 来源链接 / AI 摘要与角度 /
 *      命中词 / 收入灵感库·忽略。动作走 T5/T6 幂等 API，成功后本地移除该条目
 *      (乐观 UI，不重新整页 refetch)。
 *   3. 底部「立即扫描」+ 上轮运行摘要一行。
 *
 * 空态分级 (未配置 vs 已配置无数据) 见 `ConfigGate`/`RankingEmpty`。
 */

type RadarItemDTO = {
  id: string;
  url: string;
  title: string;
  sourceSite: string;
  publishedAt: string | null;
  collectedAt: string;
  matchedKeywords: string[];
  aiSummary: string;
  aiAngle: string;
  heatScore: number;
  displayScore: number;
  heatFactors: {
    relevance?: number;
    freshness?: number;
    discussion?: number;
    feasibility?: number;
    cooccurrenceSources?: number;
    /** 八期 T5: 人设定位调权后处理字段, 老条目 (本期上线前采集) 没有这两个键——
     * 徽标渲染走 `pickPersonaBadge`, 缺字段一律不展示 (零迁移)。 */
    pillarHit?: string | null;
    personaAdjust?: number;
  } | null;
  status: string;
  inspirationId: string | null;
  runId: string;
};

type KeywordDTO = { id: string; text: string; status: "active" | "candidate" | "ignored"; source: string };
type KeywordGroups = { active: KeywordDTO[]; candidate: KeywordDTO[]; ignored: KeywordDTO[] };

type RadarConfigSafe = { hasKey: boolean; dailyLimit: number; enabled: boolean };

type RunSummary = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  keywordsCount: number;
  searched: number;
  read: number;
  kept: number;
  errorsCount: number;
} | null;

async function fetchJson(input: string, init?: RequestInit) {
  const res = await fetch(input, init);
  return res.json();
}

export function RadarView({ setView, refreshWorkspace }: {
  setView: (view: NavView) => void;
  /** R1 终审修复: adopt 写了 cockpit 事务 (新灵感卡片 + rev bump), 本视图不消费
   * `WorkspaceState` 感知不到——调用它把 Cockpit 内存态与 rev 一起同步到服务端
   * 最新值, 见 `Cockpit.tsx` 里该回调定义处的完整说明。 */
  refreshWorkspace: () => Promise<void>;
}) {
  const [items, setItems] = useState<RadarItemDTO[] | null>(null);
  const [keywords, setKeywords] = useState<KeywordGroups | null>(null);
  const [config, setConfig] = useState<RadarConfigSafe | null>(null);
  const [lastRun, setLastRun] = useState<RunSummary>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [itemPending, setItemPending] = useState<Set<string>>(new Set());
  const [keywordPending, setKeywordPending] = useState<Set<string>>(new Set());
  const [triggering, setTriggering] = useState(false);
  /** 八期 T5: 是否已建立人设档案 —— 只用于页顶一行引导, 独立于上面四个接口的
   * 失败收敛逻辑 (取不到就不展示引导, 不阻塞雷达本身的核心功能)。 */
  const [personaEstablished, setPersonaEstablished] = useState<boolean | null>(null);

  /**
   * 四个接口任一失败（含 `success:false` 与网络异常）都要让用户看得见、可重试 ——
   * 不能因为 `config` 没拉到就整块空白（render gate 是 `!error && config`, 见下方
   * JSX）。这里不追求"部分成功部分展示"的复杂状态: 任一失败就统一收敛成一条
   * `error` 文案（取第一个失败项的 message，其余成功的分支仍然照常 setState，
   * 但既然 `error` 非空会挡住整个内容区渲染, 这些 setState 只是让重试成功前
   * 状态保持一致, 不影响当前这次渲染结果）。与 `use-dashboard-summary` 先例一致:
   * 有错误 → 展示错误 + 重试按钮, 而不是静默吞掉部分失败。
   */
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [itemsJson, keywordsJson, configJson, runJson] = await Promise.all([
        fetchJson("/api/v1/radar/items?status=new"),
        fetchJson("/api/v1/radar/keywords"),
        fetchJson("/api/v1/radar/config"),
        fetchJson("/api/v1/radar/runs/latest"),
      ]);
      let failure: string | null = null;
      if (itemsJson.success) setItems(itemsJson.data.items);
      else failure = failure ?? itemsJson.message ?? "雷达条目加载失败";
      if (keywordsJson.success) setKeywords(keywordsJson.data);
      else failure = failure ?? keywordsJson.message ?? "关键词加载失败";
      if (configJson.success) setConfig(configJson.data);
      else failure = failure ?? configJson.message ?? "雷达配置加载失败";
      if (runJson.success) setLastRun(runJson.data.run);
      else failure = failure ?? runJson.message ?? "运行记录加载失败";
      if (failure) setError(`加载失败: ${failure}`);
    } catch {
      setError("加载失败，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    fetchJson("/api/v1/persona/profile")
      .then((json) => {
        if (json?.success) setPersonaEstablished(Boolean(json.data.established));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleItemAction = async (id: string, action: "adopt" | "ignore") => {
    if (itemPending.has(id)) return;
    setItemPending((prev) => new Set(prev).add(id));
    try {
      const json = await fetchJson(`/api/v1/radar/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (json.success) {
        setItems((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
        // adopt 才需要刷新: 它是唯一一条写 cockpit 事务的动作 (新灵感卡片 + rev
        // bump)。ignore 只改 RadarItem.status, 不触碰 cockpit 表, 无需刷新。
        if (action === "adopt") await refreshWorkspace();
        setToast(action === "adopt" ? "已收入灵感库" : "已忽略该条目");
      } else {
        setToast(json.message ?? "操作失败");
      }
    } catch {
      setToast("网络错误，请重试");
    } finally {
      setItemPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleKeywordAction = async (id: string, nextStatus: "active" | "ignored") => {
    if (keywordPending.has(id)) return;
    setKeywordPending((prev) => new Set(prev).add(id));
    try {
      const json = await fetchJson(`/api/v1/radar/keywords/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (json.success) {
        setKeywords((prev) => (prev ? { ...prev, candidate: prev.candidate.filter((k) => k.id !== id) } : prev));
        setToast(nextStatus === "active" ? "已采纳关键词" : "已忽略关键词");
      } else {
        setToast(json.message ?? "操作失败");
      }
    } catch {
      setToast("网络错误，请重试");
    } finally {
      setKeywordPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTrigger = async () => {
    if (triggering) return;
    setTriggering(true);
    try {
      const json = await fetchJson("/api/v1/radar/trigger", { method: "POST" });
      setToast(json.success ? "已加入扫描队列，完成后刷新本页查看结果" : (json.message ?? "触发失败"));
    } catch {
      setToast("网络错误，请重试");
    } finally {
      setTriggering(false);
    }
  };

  const configReady = Boolean(config?.hasKey && config?.enabled);

  return <section className="page radar-page">
    <div className="page-heading">
      <span className="eyebrow">RADAR</span>
      <h1>热点雷达</h1>
      <p>按你的行业关键词全网深读，AI 逐篇阅读评分后汇总成热度排行；看中的直接收入灵感库。</p>
    </div>

    {personaEstablished === false ? <div className="radar-persona-hint">
      <p>建立人设档案让选题更贴合定位</p>
      <button type="button" className="text-button" onClick={() => setView("settings")}>去设置 →</button>
    </div> : null}

    {loading ? <p className="muted radar-status">加载中…</p> : null}
    {!loading && error ? <div className="radar-status-error">
      <p className="muted radar-status">{error}</p>
      <button type="button" className="secondary-button" onClick={() => refresh()}>重试</button>
    </div> : null}

    {!loading && !error && config ? (
      !configReady
        ? <ConfigGate hasKey={config.hasKey} enabled={config.enabled} goSettings={() => setView("settings")} />
        : <>
          {keywords && keywords.candidate.length > 0
            ? <CandidateBar candidates={keywords.candidate} pending={keywordPending} onAction={handleKeywordAction} />
            : null}

          <section className="panel radar-ranking-panel">
            <div className="panel-heading"><div><span className="eyebrow">RANKING</span><h2>热度排行</h2></div></div>
            {items && items.length > 0
              ? <div className="radar-item-grid">
                {items.map((item) => <RadarItemCard key={item.id} item={item} pending={itemPending.has(item.id)} onAction={handleItemAction} />)}
              </div>
              : <Empty title="还没有雷达条目" body="点击下方「立即扫描」跑一轮，或等待每日自动采集。" />}
          </section>

          <section className="panel radar-scan-panel">
            <div className="radar-scan-actions">
              <button type="button" className="primary-button" disabled={triggering} onClick={handleTrigger}>{triggering ? "已加入队列…" : "立即扫描"}</button>
              <p className="muted radar-run-summary">{formatRunSummary(lastRun)}</p>
            </div>
          </section>
        </>
    ) : null}

    {toast ? <div className="toast" role="status">{toast}</div> : null}
  </section>;
}

function formatRunSummary(run: RunSummary): string {
  if (!run) return "还没有运行记录";
  return `上轮扫描：扫 ${run.keywordsCount} 词 / 读 ${run.read} 篇 / 入库 ${run.kept} 条${run.errorsCount ? ` / 错误 ${run.errorsCount}` : ""}`;
}

function ConfigGate({ hasKey, enabled, goSettings }: { hasKey: boolean; enabled: boolean; goSettings: () => void }) {
  const reason = !hasKey ? "还没有配置 Tavily key" : "雷达尚未启用";
  return <Empty
    title="热点雷达还没配置好"
    body={`${reason}，配置完成后即可开始每日自动采集与热度排行。`}
    action={<button type="button" className="secondary-button" onClick={goSettings}>去设置 →</button>}
  />;
}

function CandidateBar({ candidates, pending, onAction }: {
  candidates: KeywordDTO[];
  pending: Set<string>;
  onAction: (id: string, status: "active" | "ignored") => void;
}) {
  return <section className="panel radar-candidate-bar">
    <div className="panel-heading"><div><span className="eyebrow">NEW KEYWORDS</span><h2>候选关键词</h2></div></div>
    <p className="muted radar-candidate-hint">AI 在阅读过程中从高热内容里提炼出这些新词，采纳后会加入下一轮扫描。</p>
    <div className="radar-candidate-chips">
      {candidates.map((kw) => <div key={kw.id} className="radar-candidate-chip">
        <span>{kw.text}</span>
        <button type="button" className="text-button" disabled={pending.has(kw.id)} onClick={() => onAction(kw.id, "active")}>采纳</button>
        <button type="button" className="text-button" disabled={pending.has(kw.id)} onClick={() => onAction(kw.id, "ignored")}>忽略</button>
      </div>)}
    </div>
  </section>;
}

function heatFactorsTitle(factors: RadarItemDTO["heatFactors"]): string | undefined {
  if (!factors) return undefined;
  const { relevance, freshness, discussion, feasibility, cooccurrenceSources } = factors;
  return `相关度 ${relevance ?? "—"} · 新鲜度 ${freshness ?? "—"} · 讨论强度 ${discussion ?? "—"} · 可做性 ${feasibility ?? "—"} · 共现加成 +${cooccurrenceSources ?? 0}`;
}

function RadarItemCard({ item, pending, onAction }: {
  item: RadarItemDTO;
  pending: boolean;
  onAction: (id: string, action: "adopt" | "ignore") => void;
}) {
  const personaBadge = pickPersonaBadge(item.heatFactors);
  return <article className="radar-item-card">
    <div className="radar-item-score" title={heatFactorsTitle(item.heatFactors)}>{Math.round(item.displayScore)}</div>
    <div className="radar-item-body">
      <a className="radar-item-title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
      <div className="radar-item-meta">
        <span className="radar-item-source">{item.sourceSite}</span>
        {item.matchedKeywords.map((kw) => <span key={kw} className="badge">{kw}</span>)}
        {personaBadge?.type === "pillar" ? <span className="badge">{personaBadge.name}</span> : null}
        {personaBadge?.type === "off" ? <span className="badge radar-item-badge-off">偏离定位</span> : null}
      </div>
      {item.aiSummary ? <p className="radar-item-summary">{item.aiSummary}</p> : null}
      {item.aiAngle ? <p className="radar-item-angle"><strong>可做角度：</strong>{item.aiAngle}</p> : null}
    </div>
    <div className="radar-item-actions">
      <button type="button" className="secondary-button" disabled={pending} onClick={() => onAction(item.id, "adopt")}>{pending ? "处理中…" : "收入灵感库"}</button>
      <button type="button" className="text-button" disabled={pending} onClick={() => onAction(item.id, "ignore")}>忽略</button>
    </div>
  </article>;
}
