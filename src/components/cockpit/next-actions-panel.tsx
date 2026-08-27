"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buildNextActions } from "@/lib/cockpit/next-actions";
import { PLATFORM_LABELS } from "@/lib/cockpit/model";
import { ScoreBadge } from "./script-score-card";
import type { CombinedScore } from "@/lib/cockpit/script-score";

interface ContentLike {
  id: string;
  title: string;
  stage: string;
  platform?: string;
  scriptDraftId?: string | null;
  publicationStatus?: string;
  updatedAt?: string;
}

/**
 * 首页「今天要做的」(二十一期)。
 *
 * 动因: 用户反馈"不给链接就找不到入口"。内容卡明明在库里, 但要先想清楚
 * "它在哪个平台看板的哪一列"才找得到; 原有摘要条只报数量("你有 N 条待推进"),
 * 不说是哪几条也点不进去。这里把卡直接摆出来, 配动词 + 可点链接。
 */
export function NextActionsPanel({ contents }: { contents: ContentLike[] }) {
  const rows = buildNextActions(contents);

  // 评分徽章走一个批量接口, 不按行发请求 —— 一屏十几条会打出十几个往返。
  // 拿不到就不显示徽章, 首页不因为评分挂掉。
  const [scores, setScores] = useState<Record<string, CombinedScore>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/cockpit/script-scores")
      .then((r) => r.json())
      .then((body) => { if (alive) setScores(body?.data?.scores ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return <section className="card-minimal next-actions-panel">
    <div className="next-actions-heading">
      <span className="eyebrow">今天要做的</span>
    </div>
    {rows.length === 0
      ? <p className="next-actions-empty">都推进完了。去「灵感库选题」或「模板」开一条新的。</p>
      : <ul className="next-actions-list">
          {rows.map((r) => <li key={r.id}>
            <Link href={r.href}>{r.title}</Link>
            <span className="next-actions-meta">
              {scores[r.id] ? <ScoreBadge score={scores[r.id]} /> : null}
              <span className="badge">{r.action}</span>
              <span className="next-actions-platform">{PLATFORM_LABELS[r.platform as keyof typeof PLATFORM_LABELS] ?? r.platform}</span>
            </span>
          </li>)}
        </ul>}
  </section>;
}
