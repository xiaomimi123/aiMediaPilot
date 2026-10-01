import type { Reference } from '@/lib/benchmark/adopt';

export function TopicStep({ reference }: { reference: Reference | null }) {
  if (!reference) return <div className="card text-sm text-[var(--text-secondary)]">这条没有对标作品。选题和角度在右下角和编导聊。</div>;
  const a = reference.analysis;
  return (
    <div className="space-y-3">
      <div className="card">
        <div className="t-label">对标作品</div>
        <div className="mt-1 text-[15px] font-semibold">{`${reference.author}${reference.ratio ? `（点赞是他平时的 ${reference.ratio} 倍）` : ''}`}</div>
        {a && (
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="t-label">选题</dt><dd>{a.topic}</dd></div>
            <div><dt className="t-label">{`开头钩子（${a.hook.type}）`}</dt><dd>{a.hook.quote}</dd></div>
            <div><dt className="t-label">标题写法</dt><dd>{a.titlePattern}</dd></div>
            <div><dt className="t-label">建议角度</dt><dd>{a.myAngle}</dd></div>
          </dl>
        )}
      </div>
      {reference.transcript && (
        <details className="card text-sm">
          <summary className="cursor-pointer text-[var(--text-secondary)]">逐字稿</summary>
          <p className="mt-2 whitespace-pre-wrap leading-7">{reference.transcript}</p>
        </details>
      )}
    </div>
  );
}
