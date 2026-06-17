'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ScriptGenerateResponse } from '@/lib/llm/prompts/script-generate';

interface Props {
  result: ScriptGenerateResponse;
  topic: string;
  niche: string;
  onRegenerate?: () => void;
  readonly?: boolean;
  draftId?: string;
}

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
      className="text-xs text-muted-foreground hover:text-primary"
    >
      {copied ? '✓ 已复制' : '📋 复制'}
    </button>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export function ScriptResult({ result, topic, niche, onRegenerate, readonly, draftId }: Props) {
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
        body: JSON.stringify({ topic, niche, output: result }),
      });
      const json = await res.json();
      if (!json.success) {
        setSaveError(json.message);
      } else {
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
        <h2 className="text-lg font-semibold">✏️ 脚本: {topic}</h2>
        <div className="flex gap-2">
          {!readonly && (
            <>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? '保存中...' : '💾 保存'}
              </Button>
              {onRegenerate && (
                <Button onClick={onRegenerate} variant="outline" size="sm">
                  🔄 再生成
                </Button>
              )}
            </>
          )}
          {readonly && draftId && (
            <Button onClick={handleDelete} variant="outline" size="sm">
              🗑 删除
            </Button>
          )}
        </div>
      </div>

      {saveError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveError}</div>}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">🪝 钩子 (0:00-0:03)</h3>
          <ol className="space-y-3 text-sm">
            {result.hooks.map((h, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">{i + 1}. &ldquo;{h.text}&rdquo;</p>
                    <p className="mt-1 text-xs text-muted-foreground">理由: {h.rationale}</p>
                  </div>
                  <CopyButton text={h.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">⏱ 完播节奏</h3>
          <table className="w-full text-sm">
            <tbody>
              {result.retentionBeats.map((b, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 font-mono text-xs text-muted-foreground">
                    {pad(Math.floor(b.startSec / 60))}:{pad(b.startSec % 60)}-{pad(Math.floor(b.endSec / 60))}:{pad(b.endSec % 60)}
                  </td>
                  <td className="py-2">{b.beat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">📝 标题候选</h3>
          <ol className="space-y-3 text-sm">
            {result.titles.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. {t.text}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">类型: {t.hookType}</p>
                  </div>
                  <CopyButton text={t.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">🖼 封面建议</h3>
          <p className="text-sm">
            <span className="text-muted-foreground">文字: </span>
            <b>{result.cover.textOverlay}</b>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">镜头: </span>
            {result.cover.shotIdea}
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">色调: </span>
            {result.cover.colorTone}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
