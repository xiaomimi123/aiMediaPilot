import { Suspense } from 'react';
import { ScriptForm } from '@/components/content/script-form';

export default function NewScriptPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI 脚本生成</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          给定 topic + niche, 一次生成 4 区块: 钩子 / 完播节奏 / 标题 / 封面建议。
        </p>
      </div>
      <Suspense fallback={<div className="text-sm text-[var(--muted)]">加载中…</div>}>
        <ScriptForm />
      </Suspense>
    </div>
  );
}
