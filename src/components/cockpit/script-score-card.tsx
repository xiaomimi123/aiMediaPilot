"use client";

import { useCallback, useEffect, useState } from "react";
import type { CombinedScore } from "@/lib/cockpit/script-score";

/**
 * 口播稿评分卡(二十二期)。
 *
 * 三处复用同一个组件(内容详情、提词器、首页徽章), 用 `variant` 区分详略,
 * 避免评分展示在三个地方各写一套、慢慢长歪。
 *
 * 交互上只有一条硬规则: **软指标绝不自动跑**。它要调模型花钱, 必须用户点按钮。
 * 页面加载只走 GET(硬指标现算 + 软指标读缓存)。
 */

export type ScoreVariant = "full" | "compact" | "badge";

function toneOf(total: number, max: number): "good" | "mid" | "bad" {
  const pct = max > 0 ? total / max : 0;
  if (pct >= 0.85) return "good";
  if (pct >= 0.6) return "mid";
  return "bad";
}

export function ScoreBadge({ score }: { score: CombinedScore }) {
  const tone = toneOf(score.total, score.max);
  return (
    <span className={`score-badge score-${tone}`} title={score.softScored ? "完整评分" : "只算了硬指标，未跑 AI 评分"}>
      {score.total}
      <span className="score-badge-max">/{score.max}</span>
      {score.softStale ? <span className="score-badge-stale" title="稿子改过，AI 那部分已过期">!</span> : null}
    </span>
  );
}

export function ScriptScoreCard({
  contentId,
  variant = "full",
  onNotify,
}: {
  contentId: string;
  variant?: ScoreVariant;
  onNotify?: (msg: string) => void;
}) {
  const [score, setScore] = useState<CombinedScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/cockpit/contents/${contentId}/script-score`);
      const body = await res.json();
      setScore(body?.data?.score ?? null);
    } catch {
      setError("评分读取失败");
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSoft = async () => {
    setScoring(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/cockpit/contents/${contentId}/script-score`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        const msg = body?.error ?? "评分失败";
        setError(msg);
        onNotify?.(msg);
        return;
      }
      setScore(body.data.score);
      onNotify?.("评分完成");
    } catch {
      setError("评分失败，请重试");
    } finally {
      setScoring(false);
    }
  };

  if (loading) return <p className="muted">评分加载中…</p>;
  if (!score) return null;

  return (
    <ScriptScoreView
      score={score}
      variant={variant}
      scoring={scoring}
      error={error}
      onRunSoft={runSoft}
    />
  );
}

/**
 * 纯展示层 —— 不取数、不调接口。
 *
 * 提词器页是服务端渲染的, 评分在服务端算好直接传进来, 不再多一次客户端请求
 * (录制现场少转一次圈)。`onRunSoft` 不给就不显示评分按钮 —— 开拍页面不该花钱。
 */
export function ScriptScoreView({
  score,
  variant = "full",
  scoring = false,
  error = "",
  onRunSoft,
}: {
  score: CombinedScore;
  variant?: ScoreVariant;
  scoring?: boolean;
  error?: string;
  onRunSoft?: () => void;
}) {
  if (variant === "badge") return <ScoreBadge score={score} />;

  const tone = toneOf(score.total, score.max);
  const missing = score.dimensions.filter((d) => d.score < d.max);

  return (
    <div className={`score-card score-${tone}`}>
      <div className="score-card-head">
        <div>
          <span className="eyebrow">稿子评分</span>
          <strong className="score-total">
            {score.total}
            <span className="score-total-max">/{score.max}</span>
          </strong>
        </div>
        {onRunSoft && !score.softScored ? (
          <button type="button" className="ai-button small" disabled={scoring} onClick={onRunSoft}>
            {scoring ? "评分中…" : "跑 AI 评分（+65 分）"}
          </button>
        ) : onRunSoft && score.softStale ? (
          <button type="button" className="ai-button small" disabled={scoring} onClick={onRunSoft}>
            {scoring ? "评分中…" : "稿子改过，重新评分"}
          </button>
        ) : null}
      </div>

      {!score.softScored ? (
        <p className="field-hint">
          现在只算了不花钱的硬指标（满分 35）。钩子力度、失败叙事、金句这些要判断的，点上面按钮跑一次 AI。
        </p>
      ) : null}
      {score.softStale ? (
        <p className="validation-note">稿子在评分之后改过，AI 那 65 分是旧稿的结果，仅供参考。</p>
      ) : null}

      {variant === "compact" ? (
        missing.length > 0 ? (
          <ul className="score-missing">
            {missing.map((d) => (
              <li key={d.key}>
                <span className="score-dim-label">{d.label}</span>
                <span className="score-dim-num">
                  {d.score}/{d.max}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">每一项都满分，去拍吧。</p>
        )
      ) : (
        <>
          <ul className="score-dims">
            {score.dimensions.map((d) => (
              <li key={d.key} className={d.score === d.max ? "score-dim full" : "score-dim"}>
                <div className="score-dim-row">
                  <span className="score-dim-label">{d.label}</span>
                  <span className="score-dim-num">
                    {d.score}/{d.max}
                  </span>
                </div>
                <p className="score-dim-reason">{d.reason}</p>
              </li>
            ))}
          </ul>
          {score.topFixes.length > 0 ? (
            <div className="score-fixes">
              <strong>先改这几处</strong>
              <ol>
                {score.topFixes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}

      {error ? <p className="validation-note">{error}</p> : null}
    </div>
  );
}
