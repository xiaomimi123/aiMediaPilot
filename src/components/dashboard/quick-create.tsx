import Link from 'next/link';
import { Sparkles, Video, FileText } from 'lucide-react';

export function QuickCreate() {
  return (
    <div className="overflow-hidden rounded-xl bg-brand-gradient p-5 text-white shadow-md">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" />
        <h3 className="font-semibold">快速创作</h3>
      </div>
      <p className="mt-2 text-sm text-white/85">
        灵感来了? 上传视频跑 AI 4 维诊断,或让 AI 帮你写脚本。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href="/content/preflight/new"
          className="flex items-center justify-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-white"
        >
          <Video className="h-4 w-4" />
          视频
        </Link>
        <Link
          href="/content/script/new"
          className="flex items-center justify-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-white"
        >
          <FileText className="h-4 w-4" />
          写脚本
        </Link>
      </div>
    </div>
  );
}
