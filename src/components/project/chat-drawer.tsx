'use client';

import { MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 编导对话: 关时右下角按钮, 开时电脑右侧抽屉 / 手机底部面板; 内容始终挂载, 收起不清空 */
export function ChatDrawer({ open, onOpenChange, unread, children }: { open: boolean; onOpenChange: (v: boolean) => void; unread: boolean; children: React.ReactNode }) {
  return (
    <>
      {!open && (
        <button className="btn-primary fixed bottom-[calc(var(--tabbar-h)+16px)] right-4 z-30 shadow-[var(--shadow-pop)] md:bottom-6 md:right-6" onClick={() => onOpenChange(true)}>
          <MessageCircle size={16} />
          和编导聊
          {unread && <span aria-label="有新消息" className="ml-1 h-2 w-2 rounded-full bg-[var(--danger)]" />}
        </button>
      )}
      <aside
        aria-hidden={!open}
        className={cn(
          'fixed z-40 flex flex-col bg-[var(--bg-base)] shadow-[var(--shadow-pop)] transition-transform',
          'inset-x-0 bottom-0 h-[85dvh] rounded-t-[var(--r-xl)] md:inset-x-auto md:right-0 md:top-0 md:h-full md:w-[var(--drawer-w)] md:rounded-none',
          open ? 'translate-y-0 md:translate-x-0' : 'pointer-events-none translate-y-full md:translate-x-full md:translate-y-0',
        )}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="t-label">编导</span>
          {open && (
            <button aria-label="收起对话" className="rounded-full p-1 hover:bg-[var(--bg-surface-hover)]" onClick={() => onOpenChange(false)}>
              <X size={18} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    </>
  );
}
