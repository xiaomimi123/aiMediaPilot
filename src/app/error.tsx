'use client';

/**
 * 全局错误边界(三十四期收尾补)。
 *
 * 为什么要有它: 2026-09-08 用户打开总览撞上一次瞬时的数据库连接抖动
 * (Docker 里的 postgres 一直健康, 只是那一刻 Prisma 没连上), 看到的却是
 * Next 默认的英文 "Application error" —— 不知道哪坏了, 也不知道该干什么。
 * 设计交付的原则 #2: 空态/错误要**解释原因 + 给下一步**, 错误页是这条原则
 * 最该生效的地方。
 *
 * 判断"像不像数据库问题"用的是报错文案关键词 —— 粗糙, 但这里只决定提示语
 * 的措辞, 判断错了也只是提示不够精准, 不影响任何行为。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const looksLikeDb = /database|prisma|5432|ECONNREFUSED/i.test(error.message ?? '');

  return (
    <main className="flex min-w-0 flex-1 items-center justify-center">
      <div className="w-[420px] rounded-lg border border-bad bg-bad-subtle px-5 py-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-bad">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bad" />
          这一页渲染失败了
        </p>
        <p className="mt-2 text-xs leading-5 text-fg-2">
          {looksLikeDb
            ? '连不上数据库。多半是瞬时抖动, 先点重试; 反复出现的话, 检查 Docker 里的 mediapilot-postgres 容器是否在跑。'
            : '服务端渲染时抛了错。先点重试; 反复出现的话, 看终端里 dev server 的报错。'}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-fg-4">digest: {error.digest}</p>
        ) : null}
        <button
          onClick={reset}
          className="mt-3 rounded-md bg-elevated px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          重试
        </button>
      </div>
    </main>
  );
}
