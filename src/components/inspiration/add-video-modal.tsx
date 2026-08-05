'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';
import { detectClientPlatform } from './types';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export function AddVideoModal({ onClose, onAdded }: Props) {
  const [url, setUrl] = useState('');
  const [userNote, setUserNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const detected = detectClientPlatform(url);
  const forceManual = detected.platform !== null && detected.platform !== 'douyin';
  const showManualForm = showManual || forceManual;

  const [mTitle, setMTitle] = useState('');
  const [mAuthor, setMAuthor] = useState('');
  const [mPlays, setMPlays] = useState('');
  const [mLikes, setMLikes] = useState('');
  const [mComments, setMComments] = useState('');
  const [mDuration, setMDuration] = useState('');

  // Esc to close — a11y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const submit = async (withManual: boolean) => {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { url: url.trim(), userNote: userNote.trim() };
      if (withManual) {
        body.manualMetadata = {
          title: mTitle.trim(),
          authorName: mAuthor.trim() || undefined,
          playCount: mPlays ? Number(mPlays) : undefined,
          likeCount: mLikes ? Number(mLikes) : undefined,
          commentCount: mComments ? Number(mComments) : undefined,
          durationSec: mDuration ? Number(mDuration) : undefined,
        };
      }
      const res = await fetch('/api/v1/inspiration/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        onAdded();
        onClose();
        return;
      }
      if (res.status === 422) {
        setShowManual(true);
        setError(json.message);
      } else {
        setError(json.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        // 点遮罩关闭
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[var(--ink)]">添加灵感视频</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--ink)]"
              aria-label="关闭 (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="url">视频 URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="抖音 / 小红书 / 公众号 链接或分享文本"
              disabled={saving}
              autoFocus
            />
            <p className="text-xs text-[var(--muted)]">
              {detected.platform === 'douyin' && '🎬 抖音 — 系统会自动抓数据'}
              {detected.platform === 'xiaohongshu' && '📕 小红书 — 无 crawler, 请手动填标题'}
              {detected.platform === 'gongzhonghao' && '📰 公众号 — 无 crawler, 请手动填标题'}
              {detected.platform === null && '支持抖音 / 小红书 / 公众号 URL 或分享文本'}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="note">我的笔记 (可选)</Label>
            <Input
              id="note"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="例: 钩子很强 / 标题用法记下"
              disabled={saving}
            />
          </div>

          {showManualForm && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">
                {forceManual
                  ? `${detected.platform === 'xiaohongshu' ? '📕 小红书' : '📰 公众号'} 无 crawler, 请手动填:`
                  : '⚠️ 自动抓取没拿到数据, 请手动填:'}
              </p>
              <div className="space-y-1">
                <Label htmlFor="m-title">标题 (必填)</Label>
                <Input id="m-title" value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="m-author">作者</Label>
                  <Input id="m-author" value={mAuthor} onChange={(e) => setMAuthor(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-plays">播放数</Label>
                  <Input id="m-plays" type="number" value={mPlays} onChange={(e) => setMPlays(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-likes">点赞</Label>
                  <Input id="m-likes" type="number" value={mLikes} onChange={(e) => setMLikes(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-comments">评论</Label>
                  <Input id="m-comments" type="number" value={mComments} onChange={(e) => setMComments(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="m-duration">时长 (秒)</Label>
                  <Input id="m-duration" type="number" value={mDuration} onChange={(e) => setMDuration(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              取消 (Esc)
            </Button>
            {!showManualForm ? (
              <Button onClick={() => submit(false)} disabled={!url.trim() || saving} variant="brand">
                {saving ? '抓取中...' : '抓取并添加'}
              </Button>
            ) : (
              <Button onClick={() => submit(true)} disabled={!mTitle.trim() || saving} variant="brand">
                {saving ? '保存中...' : '保存'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
