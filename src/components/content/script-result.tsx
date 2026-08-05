'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  DouyinScriptResponse,
  XHSScriptResponse,
  ArticleScriptResponse,
} from '@/lib/llm/prompts';
import type { PickedState } from '@/lib/script-picked/types';
import type { ContentPlatform } from '@/lib/platform';
import { PickPanel } from './pick-panel';

export type Platform = ContentPlatform;

interface Props {
  platform: Platform;
  result: Record<string, unknown>;
  topic: string;
  niche: string;
  onRegenerate?: () => void;
  readonly?: boolean;
  draftId?: string;
  initialPicked?: PickedState | null;
  ideaId?: string;
  cockpitId?: string;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  douyin: '抖音脚本',
  xiaohongshu: '小红书笔记',
  gongzhonghao: '公众号文章',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
      className="text-xs text-[var(--muted)] hover:text-primary"
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function UseScriptCard({ result, niche, draftId }: { result: DouyinScriptResponse; niche: string; draftId: string }) {
  const router = useRouter();
  const [titleIdx, setTitleIdx] = useState(0);
  const [hookIdx, setHookIdx] = useState(0);

  const handleGo = () => {
    const params = new URLSearchParams({
      title: result.titles[titleIdx].text,
      caption: result.hooks[hookIdx].text,
      niche,
      fromScript: draftId,
    });
    router.push(`/content/preflight/new?${params.toString()}`);
  };

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardContent className="space-y-3 pt-6">
        <h3 className="font-semibold">用此脚本开新分析</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted)]">标题</label>
            <select
              value={titleIdx}
              onChange={(e) => setTitleIdx(Number(e.target.value))}
              className="w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
            >
              {result.titles.map((t, i) => (
                <option key={i} value={i}>
                  {i + 1}. {t.text}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted)]">钩子作为开场</label>
            <select
              value={hookIdx}
              onChange={(e) => setHookIdx(Number(e.target.value))}
              className="w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
            >
              {result.hooks.map((h, i) => (
                <option key={i} value={i}>
                  {i + 1}. {h.text}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button onClick={handleGo} size="sm">
          开新分析 →
        </Button>
      </CardContent>
    </Card>
  );
}

function DouyinView({ data }: { data: DouyinScriptResponse }) {
  return (
    <>
      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">钩子 (0:00-0:03)</h3>
          <ol className="space-y-3 text-sm">
            {data.hooks.map((h, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. &ldquo;{h.text}&rdquo;
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">理由: {h.rationale}</p>
                  </div>
                  <CopyButton text={h.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">⏱ 完播节奏</h3>
          <table className="w-full text-sm">
            <tbody>
              {data.retentionBeats.map((b, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 font-mono text-xs text-[var(--muted)]">
                    {pad(Math.floor(b.startSec / 60))}:{pad(b.startSec % 60)}-{pad(Math.floor(b.endSec / 60))}:{pad(b.endSec % 60)}
                  </td>
                  <td className="py-2">{b.beat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">标题候选</h3>
          <ol className="space-y-3 text-sm">
            {data.titles.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. {t.text}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">类型: {t.hookType}</p>
                  </div>
                  <CopyButton text={t.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">封面建议</h3>
          <p className="text-sm">
            <span className="text-[var(--muted)]">文字: </span>
            <b>{data.cover.textOverlay}</b>
          </p>
          <p className="text-sm">
            <span className="text-[var(--muted)]">镜头: </span>
            {data.cover.shotIdea}
          </p>
          <p className="text-sm">
            <span className="text-[var(--muted)]">色调: </span>
            {data.cover.colorTone}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function XHSView({ data }: { data: XHSScriptResponse }) {
  return (
    <>
      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">标题候选</h3>
          <ol className="space-y-3 text-sm">
            {data.titles.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. {t.text}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">类型: {t.hookType}</p>
                  </div>
                  <CopyButton text={t.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">封面大字</h3>
            <CopyButton text={data.coverText} />
          </div>
          <p className="text-2xl font-bold tracking-tight">{data.coverText}</p>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">笔记开头钩子</h3>
            <CopyButton text={data.intro} />
          </div>
          <p className="text-sm whitespace-pre-wrap">{data.intro}</p>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">正文</h3>
            <CopyButton text={data.body} />
          </div>
          <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{data.body}</pre>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">标签</h3>
            <CopyButton text={data.tags.map((t) => `#${t}`).join(' ')} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.tags.map((tag, i) => (
              <span key={i} className="rounded bg-pink-100 px-2 py-1 text-xs text-pink-900">
                #{tag}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">配图建议</h3>
          <ol className="space-y-2 text-sm">
            {data.shotIdeas.map((s) => (
              <li key={s.idx} className="flex items-start gap-2 border-b pb-2">
                <span className="font-mono text-xs text-[var(--muted)]">图 {s.idx}</span>
                <span className="flex-1">{s.description}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}

function GongzhonghaoView({ data }: { data: ArticleScriptResponse }) {
  return (
    <>
      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">标题候选</h3>
          <ol className="space-y-3 text-sm">
            {data.titles.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. {t.text}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">类型: {t.hookType}</p>
                  </div>
                  <CopyButton text={t.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">摘要</h3>
            <CopyButton text={data.abstract} />
          </div>
          <p className="text-sm">{data.abstract}</p>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">大纲</h3>
            <CopyButton text={data.outline.map((o, i) => `${i + 1}. ${o}`).join('\n')} />
          </div>
          <ol className="space-y-1 text-sm">
            {data.outline.map((o, i) => (
              <li key={i} className="border-b pb-1">
                <span className="font-mono text-xs text-[var(--muted)]">h2 #{i + 1}</span>{' '}
                {o}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">正文初稿</h3>
            <CopyButton text={data.body} />
          </div>
          <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{data.body}</pre>
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">文末互动</h3>
            <CopyButton text={data.cta} />
          </div>
          <p className="text-sm whitespace-pre-wrap">{data.cta}</p>
        </CardContent>
      </Card>
    </>
  );
}

export function ScriptResult({ platform, result, topic, niche, onRegenerate, readonly, draftId, initialPicked, ideaId, cockpitId }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/v1/scripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic,
          niche,
          platform,
          output: result,
          ...(cockpitId ? { cockpitContentId: cockpitId } : {}),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setSaveError(json.message);
      } else {
        if (ideaId) {
          // 选题采纳登记失败不阻塞保存流程
          await fetch(`/api/v1/topics/${ideaId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'ADOPTED', scriptDraftId: json.data.id }),
          }).catch(() => {});
        }
        router.push(`/content/script/${json.data.id}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draftId) return;
    if (!confirm('确认删除该脚本?')) return;
    await fetch(`/api/v1/scripts/${draftId}`, { method: 'DELETE' });
    router.push('/content/script');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {PLATFORM_LABEL[platform]}: {topic}
        </h2>
        <div className="flex gap-2">
          {!readonly && (
            <>
              <Button onClick={handleSave} disabled={saving} size="sm" variant="brand">
                {saving ? '保存中...' : '保存'}
              </Button>
              {onRegenerate && (
                <Button onClick={onRegenerate} variant="outline" size="sm">
                  再生成
                </Button>
              )}
            </>
          )}
          {readonly && draftId && (
            <Button onClick={handleDelete} variant="outline" size="sm">
              删除
            </Button>
          )}
        </div>
      </div>

      {saveError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveError}</div>}

      {/* D1: 发布前选定 — 所有平台都展示 (readonly 即已保存) */}
      {readonly && draftId && (
        <PickPanel
          draftId={draftId}
          platform={platform}
          titles={((result as Record<string, unknown>).titles as { text: string }[] | undefined) ?? []}
          hooks={
            platform === 'douyin'
              ? ((result as unknown as DouyinScriptResponse).hooks as { text: string }[])
              : undefined
          }
          initial={initialPicked ?? null}
        />
      )}

      {/* "用此脚本开新分析" — 抖音 only (其它平台没有视频分析闭环) */}
      {readonly && draftId && platform === 'douyin' && (
        <UseScriptCard result={result as unknown as DouyinScriptResponse} niche={niche} draftId={draftId} />
      )}

      {platform === 'douyin' && <DouyinView data={result as unknown as DouyinScriptResponse} />}
      {platform === 'xiaohongshu' && <XHSView data={result as unknown as XHSScriptResponse} />}
      {platform === 'gongzhonghao' && <GongzhonghaoView data={result as unknown as ArticleScriptResponse} />}
    </div>
  );
}
