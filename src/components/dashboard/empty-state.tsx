import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-muted/30 py-20 text-center">
      <div className="text-5xl">📊</div>
      <h2 className="mt-4 text-xl font-semibold">还没有分析数据</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        上传第一个视频, 让 AI 帮你诊断钩子 / 完播 / 标题 / 封面
      </p>
      <Link href="/content/preflight/new" className="mt-6">
        <Button size="lg">+ 新分析</Button>
      </Link>
    </div>
  );
}
