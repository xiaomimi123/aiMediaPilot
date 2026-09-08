'use client';

import { useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface RadarRow {
  id: string;
  /** 源文章标题。可能是英文 —— 它是出处, 不是选题。 */
  title: string;
  url: string;
  source: string;
  heat: number;
  /** AI 生成的中文选题角度 —— **这才是能直接拿去做视频的东西**。 */
  angle: string;
  summary: string;
  collectedAt: string;
}
interface InspirationRow { id: string; text: string; createdAt: string; used: number }
interface HotRow {
  id: string;
  title: string;
  hotValue: number;
  peakHotValue: number;
  /** 第一次在榜上看到它是什么时候 —— 「热了多久」比「此刻多热」有用 */
  firstSeenAt: string;
  adopted: boolean;
}

/**
 * 选题两个 tab。
 *
 * **中文角度是主角, 英文源标题是配角**。第一版把源标题放在主位, 结果一屏里
 * 四分之一是英文新闻标题 —— 那是出处不是选题, 你不会照着 "AI Model Captures How
 * Humans Read" 去拍一条视频, 但会照着「AI 终于读懂你怎么读东西」去拍。
 *
 * 热度分不做主排序: 103 条里 57 条都是 100 分, 按它排和随机排没区别。改成按采集
 * 时间倒序(新的在前), 热度只作为一个标记显示。这不是热度算法的问题该在这里修,
 * 而是**一个区分不了东西的信号不该拿来做排序**。
 */
export function TopicTabs({
  radar, radarTotal, adoptedCount, inspirations, hot,
}: {
  radar: RadarRow[];
  radarTotal: number;
  adoptedCount: number;
  inspirations: InspirationRow[];
  hot: HotRow[];
}) {
  // 默认停在灵感库而不是雷达: 这个账号是做人设的, 选题主要来自拆同赛道创作者
  // (拆解结果会写进灵感库), 而不是评论行业新闻。雷达留着但不占主位。
  const [tab, setTab] = useState<'inspiration' | 'hot' | 'radar'>('inspiration');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hotRows, setHotRows] = useState(hot);
  const [radarRows, setRadarRows] = useState(radar);
  // 灵感库也转本地 state: 采纳的下一个动作就是「切到灵感库看一眼」, 列表若还是
  // 服务端渲染的旧数据, 刚存的那条要刷新页面才出现 —— 像丢了。
  const [inspRows, setInspRows] = useState(inspirations);
  const [busy, setBusy] = useState<string | null>(null);
  // 本地采纳/忽略过几条, 让「待处理 N 条」跟着降 —— 不然点完数字不动, 像没生效
  const [handled, setHandled] = useState(0);
  const backlog = radarTotal - adoptedCount - handled;

  async function adoptHot(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/hot-topics/${id}/adopt`, { method: 'POST' });
      if (res.ok) setHotRows((rs) => rs.map((r) => (r.id === id ? { ...r, adopted: true } : r)));
    } finally {
      setBusy(null);
    }
  }

  /**
   * 雷达条目 采纳/忽略(三十四期补)。后端 PATCH 四期就建好了(带事务与幂等守卫),
   * 但前端一直只做了「展开看详情」—— 想把雷达文章收进灵感库, 界面上无路可走。
   * 成功后把这一条从列表里移掉: 列表本来就只显示待处理(status=new)的。
   * 失败时**不动列表** —— 静默吞掉失败会让人以为存进去了。
   */
  async function handleRadar(id: string, action: 'adopt' | 'ignore') {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/radar/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const row = radarRows.find((r) => r.id === id);
        setRadarRows((rs) => rs.filter((r) => r.id !== id));
        setHandled((n) => n + 1);
        if (action === 'adopt' && row) {
          // 文案拼法与后端一致(title\n角度\n摘要\nurl), 刷新后两边长得一样
          const body = (await res.json()) as { data?: { inspirationId?: string } };
          setInspRows((list) => [{
            id: body.data?.inspirationId ?? id,
            text: [row.title, row.angle, row.summary, row.url].filter(Boolean).join('\n'),
            createdAt: new Date().toISOString().slice(0, 10),
            used: 0,
          }, ...list]);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Tabs
        className="mb-4 max-w-md"
        tabs={[
          { value: 'inspiration' as const, label: `灵感库 ${inspRows.length}` },
          { value: 'hot' as const, label: `抖音热搜 ${hotRows.length}` },
          { value: 'radar' as const, label: `热点雷达 ${radarTotal}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'hot' ? (
        <>
          {/*
            这一栏和雷达的区别: 雷达抓的是外网行业新闻, 热搜是**抖音自己推给创作者
            的站内热点** —— 它已经是平台判定为正在热的话题, 而且是中文口语化的
            (「30岁了一事无成的人该做什么工作」), 直接就是选题, 不需要 AI 再改写一遍。
          */}
          <p className="mb-3 rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">抖音自己推给创作者的站内热搜。</span>{' '}
            它已经是平台判定正在热的话题，而且本来就是中文口语化的，不用再让 AI 改写成「选题角度」——
            怎么切是你写稿时的判断。存进灵感库的是<span className="font-medium text-foreground">原样的热搜词</span>。
          </p>

          {hotRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没抓到热搜。跑一次 <code className="rounded bg-secondary px-1 py-0.5">npm run collect:douyin</code>。
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
              {hotRows.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{h.title}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      热度 {h.hotValue.toLocaleString()}
                      {h.peakHotValue > h.hotValue ? `（峰值 ${h.peakHotValue.toLocaleString()}）` : ''}
                      {' · '}
                      {h.firstSeenAt} 起在榜
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={h.adopted || busy === h.id}
                    onClick={() => void adoptHot(h.id)}
                    className={cn(
                      'shrink-0 rounded-md border px-3 py-1.5 text-xs transition-colors',
                      h.adopted
                        ? 'border-border text-muted-foreground/60'
                        : 'border-border bg-card hover:border-foreground/30',
                    )}
                  >
                    {h.adopted ? '已存入' : busy === h.id ? '存入中…' : '存进灵感库'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : tab === 'radar' ? (
        <>
          <p className="mb-3 rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">这一栏抓的是行业新闻，不一定适合你。</span>{' '}
            你唯一的爆款靠的是「我做了个东西、解决了什么痛点」，那类内容里有你；
            而新闻点评里没有你，要跟所有资讯号抢同一条新闻。
            做人设的账号，选题更该来自<span className="font-medium text-foreground">拆同赛道创作者</span>。
            待处理 {backlog} 条，翻不完是正常的。
          </p>

          {radarRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">雷达还没抓到东西。</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
              {radarRows.map((r) => {
                const open = expanded === r.id;
                return (
                  <li key={r.id} className="p-3">
                    {/* 展开钮与动作钮是并排的兄弟, 不嵌套 —— button 里包 button 是非法 DOM */}
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="block min-w-0 flex-1 text-left"
                      >
                        <p className="text-sm leading-relaxed">{r.angle || r.title}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{r.source}</span>
                          <span>·</span>
                          <span>{r.collectedAt}</span>
                          {r.heat >= 100 ? null : (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">热度 {r.heat}</span>
                            </>
                          )}
                          <span className={cn('ml-auto', open && 'rotate-180')}>⌄</span>
                        </p>
                      </button>
                      <div className="flex shrink-0 gap-1.5 pt-0.5">
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => void handleRadar(r.id, 'adopt')}
                          className="rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-foreground/30 disabled:opacity-50"
                        >
                          {busy === r.id ? '处理中…' : '存进灵感库'}
                        </button>
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => void handleRadar(r.id, 'ignore')}
                          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        >
                          忽略
                        </button>
                      </div>
                    </div>

                    {open ? (
                      <div className="mt-2 border-l-2 border-border pl-3">
                        {r.summary ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">{r.summary}</p>
                        ) : null}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          原文：
                          <a href={r.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                            {r.title}
                          </a>
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : inspRows.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          灵感库是空的。去「拆解」拆一条同赛道创作者的片子，衍生的选题会自动写进这里。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
          {inspRows.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-4 p-3">
              <p className="min-w-0 text-sm leading-relaxed">{i.text}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {i.used > 0 ? `已用 ${i.used} 次` : i.createdAt}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
