'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  initialValue: string | null;
  retroMedian: number | null;
  retroCount: number;
}

export function BaselineForm({ initialValue, retroMedian, retroCount }: Props) {
  const router = useRouter();
  const [inputValue, setInputValue] = useState<string>(initialValue ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSave = async () => {
    setMessage(null);
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMessage({ type: 'error', text: '请填一个 > 0 的数字' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/user/baseline', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: parsed }),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage({ type: 'error', text: json.message });
      } else {
        setMessage({ type: 'success', text: `已保存: ${json.data.baselinePlays}` });
        router.refresh();
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('确认清空 baseline? 之后 L1 预测会回到冷启动态。')) return;
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch('/api/v1/user/baseline', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: null }),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage({ type: 'error', text: json.message });
      } else {
        setInputValue('');
        setMessage({ type: 'success', text: '已清空, 回到冷启动态' });
        router.refresh();
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleUseAuto = () => {
    if (retroMedian !== null) {
      setInputValue(retroMedian.toString());
    }
  };

  return (
    <div className="space-y-4">
      {retroMedian !== null && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          📊 自动计算 (基于 {retroCount} 条复盘 median): <b>{retroMedian}</b>
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={handleUseAuto}
            disabled={saving}
          >
            用自动值
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="baseline-input">播放数 (1 - 1e8)</Label>
        <Input
          id="baseline-input"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="例如: 800"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={saving}
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || inputValue.trim() === ''} variant="brand">
          {saving ? '保存中...' : '保存'}
        </Button>
        <Button variant="outline" onClick={handleClear} disabled={saving}>
          清空 (回到冷启动)
        </Button>
      </div>

      {message && (
        <p
          className={
            message.type === 'success'
              ? 'text-sm text-green-700'
              : 'text-sm text-destructive'
          }
        >
          {message.text}
        </p>
      )}

      {retroCount >= 3 && (
        <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          💡 ≥3 条复盘时, 新分析自动用 retro median, 这里写的值会在下次复盘时被覆盖。
        </p>
      )}
    </div>
  );
}
