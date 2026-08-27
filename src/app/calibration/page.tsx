import { PageShell } from '@/components/layout/page-shell';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export default function CalibrationPage() {
  return (
    <PageShell title="校准" description="把预测分和实际表现放进同一张图，让评分模型逐渐变准。">
      <NotBuiltYet
        what="校准尚未开始运行，样本 0 条"
        why="它需要至少 30 条「已发布 + 已回采」的内容才能拟合权重。当前发布 0 条。这是三层反馈回路里的慢回路，它在等中回路（发布后回采），而中回路在等出片链路。评分权重目前是我按经验定的，还没有被真实数据修正过。"
        waitingFor={{ text: '看链路断在哪一环', href: '/data' }}
      />
    </PageShell>
  );
}
