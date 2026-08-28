import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { buildLoopStatus, CALIBRATION_MIN_SAMPLES } from '@/lib/cockpit/feedback-loop';
import { HARD_WEIGHTS } from '@/lib/cockpit/script-score';
import { SOFT_DIMENSION_META } from '@/lib/llm/prompts/script-soft-score';
import { LoopStatus } from '@/components/overview/loop-status';

export const dynamic = 'force-dynamic';

const HARD_LABELS: Record<string, string> = {
  duration: '时长偏差', concise: '简洁度', trust: '信任声明',
  compliance: '平台合规', structure: '幕结构完整', universal: '普适化结尾',
};

/**
 * 校准(v5 阶段 E2)。
 *
 * 这一页当前的全部职责是**说清楚它为什么还不能工作**, 以及把「现在的权重是谁定的」
 * 摊开 —— 权重是按经验拍的, 没被任何真实数据修正过。用户有权知道他看到的分数
 * 建立在什么基础上。
 */
export default async function CalibrationPage() {
  const user = await getOrCreateDefaultUser();
  const [scriptCount, publishedCount] = await Promise.all([
    prisma.scriptDraft.count({ where: { userId: user.id, archivedAt: null } }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
  ]);

  // 回采数据当前没有任何来源, 如实按 0 算
  const measuredCount = 0;
  const layers = buildLoopStatus({ scriptCount, publishedCount, measuredCount });

  return (
    <PageShell title="校准" description="把预测分和实际表现放进同一张图，让评分模型逐渐变准。">
      <section className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">
          校准尚未开始运行，样本 0 条
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          重拟合权重需要至少 {CALIBRATION_MIN_SAMPLES} 条「已发布 + 已回采」的内容。
          当前发布 {publishedCount} 条。这是三层回路里的慢回路，它在等中回路，而中回路在等出片链路。
        </p>
      </section>

      <LoopStatus layers={layers} />

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">当前权重是怎么来的</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          下面这套权重是<span className="font-medium text-foreground">按经验定的</span>，
          没有被任何真实表现数据修正过。校准跑起来之后，它会被真实完播率重新拟合——
          在那之前，分数的相对高低有参考价值，绝对值不必当真。
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium">硬指标 35（纯函数）</p>
            <ul className="mt-1.5 flex flex-col gap-1 text-xs">
              {Object.entries(HARD_WEIGHTS).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{HARD_LABELS[k] ?? k}</span>
                  <span className="tabular-nums">{v}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium">软指标 65（DeepSeek）</p>
            <ul className="mt-1.5 flex flex-col gap-1 text-xs">
              {SOFT_DIMENSION_META.map((d) => (
                <li key={d.key} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="tabular-nums">{d.max}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
