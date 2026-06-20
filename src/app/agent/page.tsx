import Link from 'next/link';
import { Suspense } from 'react';
import { ScriptForm } from '@/components/content/script-form';

export default function AgentPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">🪄 AI 自媒体智能体</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选平台 → 选垂类 → 输 topic, 一次生成 platform-ready 内容,复制粘贴去发。
        </p>
      </div>

      <Link
        href="/agent/inspiration"
        className="block rounded-xl border border-purple-200 bg-purple-50/50 p-4 transition-colors hover:bg-purple-50"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">📚</span>
          <div className="flex-1">
            <p className="font-semibold">灵感视频库</p>
            <p className="text-xs text-muted-foreground">
              没 topic 想法? 收集对标爆款 → AI 总结共性 → 推荐你下一步可做的 topic
            </p>
          </div>
          <span className="text-muted-foreground">→</span>
        </div>
      </Link>

      <Suspense fallback={<div className="text-sm text-muted-foreground">加载中…</div>}>
        <ScriptForm />
      </Suspense>
    </div>
  );
}
