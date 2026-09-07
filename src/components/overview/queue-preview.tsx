import Link from 'next/link';
import { waitingOn } from '@/lib/cockpit/production-stage';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  title: string;
  mode: string;
  status: string;
  createdAt: string;
}

// 与 film-queue.tsx 的 LABEL 同源含义, 但这里只做总览页的只读预览(不含启动按钮),
// 没有必要把整份 FilmQueue(带 health 轮询、启动交互)搬过来, 所以单独存一份文案表。
const LABEL: Record<string, string> = {
  queued: '排队中', source_uploaded: '视频已上传', directing: '构思分镜中', building: '搭建画面中',
  assembling: '拼接预览中', preview_ready: '预览就绪', approved: '已确认', rendering: '渲染中',
  packaging: '包装中', done: '已完成', failed: '生成失败', plan_ready: '分镜待确认',
};

/** 状态 → 徽章色调, 复用 waitingOn 的判断(等你/在跑/完成), 只是多分出 failed 单独标红。 */
function toneOf(status: string): 'warn' | 'info' | 'ok' | 'bad' {
  if (status === 'failed') return 'bad';
  const w = waitingOn(status);
  if (w === 'you') return 'warn';
  if (w === 'nobody') return 'ok';
  return 'info';
}

const TONE_CLASS: Record<string, string> = {
  warn: 'bg-warn-subtle text-warn',
  info: 'bg-info-subtle text-info',
  ok: 'bg-ok-subtle text-ok',
  bad: 'bg-bad-subtle text-bad',
};

/**
 * 出片队列(总览页右栏, 对照设计稿 #p-overview 的「出片队列」卡)。
 *
 * 只读预览 —— 最近几条任务, 不带启动/重试交互(那是成片页 FilmQueue 的事)。
 * 没有任务时如实说明, 不是每个空态都要写很长, 但要说清「去哪能看到全部」。
 */
export function QueuePreview({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-lg border border-line-subtle bg-surface">
      <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3.5">
        <h2 className="flex-1 text-sm font-semibold text-fg">出片队列</h2>
        <Link href="/films" className="text-xs font-medium text-brand hover:text-brand-hover">
          查看全部
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3.5 text-xs leading-relaxed text-fg-3">
          还没有出片任务 —— 稿子写完、进了「成片」流程之后会出现在这里。
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="border-t border-line-subtle first:border-t-0">
              <Link href={`/films/${r.id}`} className="block px-4 py-3 hover:bg-surface-hover">
                <p className="truncate text-[13px] font-medium text-fg">{r.title}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={cn('badge-base', TONE_CLASS[toneOf(r.status)])}>
                    {LABEL[r.status] ?? r.status}
                  </span>
                  <span className="text-[11px] text-fg-3">{r.mode} · {r.createdAt}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
