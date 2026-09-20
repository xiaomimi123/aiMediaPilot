'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 「特效编辑台」入口(2026-09-20, Overlay Studio 集成)。
 *
 * 只出现在真人出镜片的详情页。点一下: 后端把校对过的转写做成 SRT、DeepSeek
 * 生成整期编排 JSON(过 Studio 体检)、拉起 Studio —— 用户拿到的是"可以直接
 * 开始微调"的状态, 而不是一堆要自己跑的命令。
 *
 * 步骤说明写死在面板里: 目标用户是小白, "去哪导入什么"这句必须在按钮旁边,
 * 不能指望他记得住另一个工具的用法(三十五期"剪辑台在哪"的教训)。
 */
export function OverlayStudioPanel({ productionId }: { productionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | {
    studioUrl: string | null;
    overlayJsonPath: string;
    srtPath: string;
    warns: string[];
  }>(null);

  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${productionId}/overlay-studio`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.message ?? `准备失败(HTTP ${res.status})`);
        return;
      }
      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg">特效编辑台(Overlay Studio)</h2>
      <p className="mt-1 text-xs leading-relaxed text-fg-3">
        给这条口播片配可视化编辑的动效层：AI 按你的字幕生成整期编排，你在编辑台里拖着改，
        导出透明动效层去剪映和原片合成——原片一帧不压。生成编排约需 1~2 分钟。
      </p>
      {!result ? (
        <Button size="sm" className="mt-3" disabled={busy} onClick={() => void prepare()}>
          {busy ? '生成编排中…(约 1~2 分钟)' : '生成特效编排并打开编辑台'}
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-2 text-xs leading-relaxed text-fg-2">
          <p className="text-ok">编排已生成并通过体检。接下来在编辑台里：</p>
          <ol className="list-decimal pl-4">
            <li>点顶栏「导入视频」→ 选这条片的出镜原片</li>
            <li>点「导入 JSON」→ 选 <code className="break-all text-fg-3">{result.overlayJsonPath}</code></li>
            <li>空格播放，逐卡微调，点「导出透明 MOV」→ 剪映里盖在原片上</li>
          </ol>
          {result.warns.length > 0 ? (
            <div className="rounded-md bg-warn-subtle px-2 py-1.5 text-warn">
              {result.warns.map((w) => <p key={w}>{w}</p>)}
            </div>
          ) : null}
          {result.studioUrl ? (
            <a href={result.studioUrl} target="_blank" rel="noreferrer" className="text-brand hover:text-brand-hover">
              打开编辑台 →
            </a>
          ) : (
            <p className="text-warn">编辑台没能自动启动——在 tools/overlay-studio/motion-playground 里跑 npm run dev 后访问 localhost:5177。</p>
          )}
          <button type="button" className="self-start text-fg-4 hover:text-fg-2" disabled={busy} onClick={() => void prepare()}>
            重新生成编排(会覆盖, 手调过的别点)
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
