# Baseline Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能 GUI 修改 `User.baselinePlays` (而非动 DB) — 入口从 PredictionCard 进入 `/settings/baseline` 页, PUT API 写库, 完成 L1 v1 留下的 settings 缺口。

**Architecture:** 1 个 PUT API 路由 (含 vitest 单测) + 1 个 RSC 页 (读 baseline + retro median) + 1 个 client form 组件 (3 按钮: 保存 / 清空 / 用自动值) + 改造 PredictionCard 两态加跳转 Link。 无新表 / 无 schema 变更。

**Tech Stack:** Next.js 14 + TypeScript + Prisma + vitest

**Spec:** `docs/superpowers/specs/2026-06-15-baseline-settings-design.md`

**Scope** (不在本计划):
- 通用 `/settings` index 页 (留 v3)
- baseline 模式切换器 (auto vs manual) — 不做, 始终允许 manual override 加文案提示
- Toast 通知系统 — 用最简单的 inline `<p>` 状态提示

---

## File Structure

```
新建:
src/app/api/v1/user/baseline/route.ts              # PUT handler — 写 User.baselinePlays
src/app/settings/baseline/page.tsx                 # RSC: 读 baseline + retro median, 传 props
src/components/settings/baseline-form.tsx          # client: input + 3 按钮 + PUT call
tests/api/user/baseline.test.ts                    # 8 个 PUT 单测

修改:
src/components/content/prediction-card.tsx         # fallback 加 Link 按钮 + 数据态加修改 link
```

---

## Test Strategy

- **API** (PUT route) 8 个 vitest 单测覆盖: valid number, null clear, 0, negative, overflow, NaN, non-number, prisma error
- **UI** (page.tsx + baseline-form.tsx + PredictionCard 修改) 不写单测 (沿用 phase 1 风格, 走手动 E2E)

测试框架: vitest

---

## Git

每个 task 末尾 commit。 前缀: `feat(baseline-settings): ...` / `fix(baseline-settings): ...`。

---

## Task 1: PUT `/api/v1/user/baseline` (TDD)

**Files:**
- Create: `src/app/api/v1/user/baseline/route.ts`
- Create: `tests/api/user/baseline.test.ts`

### Step 1.1 — Write failing tests

Write `tests/api/user/baseline.test.ts` with EXACTLY:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  user: { update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { PUT } from '@/app/api/v1/user/baseline/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/user/baseline', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.update.mockResolvedValue({ baselinePlays: 800n });
});

describe('PUT /api/v1/user/baseline', () => {
  it('value=800 → 200 success, baselinePlays="800"', async () => {
    const res = await PUT(makeReq({ value: 800 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.baselinePlays).toBe('800');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { baselinePlays: 800n },
    });
  });

  it('value=null → 200, clears baseline', async () => {
    prismaMock.user.update.mockResolvedValueOnce({ baselinePlays: null });
    const res = await PUT(makeReq({ value: null }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.baselinePlays).toBeNull();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { baselinePlays: null },
    });
  });

  it('value=0 → 400', async () => {
    const res = await PUT(makeReq({ value: 0 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('value=-1 → 400', async () => {
    const res = await PUT(makeReq({ value: -1 }));
    expect(res.status).toBe(400);
  });

  it('value=1e9 (>1e8 上限) → 400', async () => {
    const res = await PUT(makeReq({ value: 1e9 }));
    expect(res.status).toBe(400);
  });

  it('value="abc" (非数字) → 400', async () => {
    const res = await PUT(makeReq({ value: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('value=NaN → 400', async () => {
    const res = await PUT(makeReq({ value: NaN }));
    expect(res.status).toBe(400);
  });

  it('prisma update 抛错 → 500', async () => {
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));
    const res = await PUT(makeReq({ value: 800 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/db down|保存失败/);
  });
});
```

- [ ] **Step 1.2: Run test (expect FAIL)**

```bash
npm test -- user/baseline
```

Expected: FAIL (module not found).

- [ ] **Step 1.3: Implement route**

Write `src/app/api/v1/user/baseline/route.ts` with EXACTLY:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const MAX_BASELINE = 1e8;

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const value = (body as { value?: unknown })?.value;

  if (value === null) {
    // 清空
    try {
      const user = await getOrCreateDefaultUser();
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { baselinePlays: null },
      });
      return ok({ baselinePlays: updated.baselinePlays?.toString() ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[PUT user/baseline] clear failed', e);
      return fail(`保存失败: ${msg}`, 500);
    }
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_BASELINE) {
    return fail(`baselinePlays 必须是 0 < value ≤ ${MAX_BASELINE} 的数字, 或 null`, 400);
  }

  try {
    const user = await getOrCreateDefaultUser();
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { baselinePlays: BigInt(Math.round(value)) },
    });
    return ok({ baselinePlays: updated.baselinePlays?.toString() ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PUT user/baseline] set failed', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
```

- [ ] **Step 1.4: Run test (expect PASS)**

```bash
npm test -- user/baseline
```

Expected: PASS (8 tests).

- [ ] **Step 1.5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/app/api/v1/user/baseline/route.ts tests/api/user/baseline.test.ts
git commit -m "feat(baseline-settings): PUT /api/v1/user/baseline — set/clear User.baselinePlays"
```

---

## Task 2: `BaselineForm` client component

**Files:**
- Create: `src/components/settings/baseline-form.tsx`

- [ ] **Step 2.1 — Implement BaselineForm**

Write `src/components/settings/baseline-form.tsx` with EXACTLY:

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  initialValue: string | null;        // BigInt 序列化为 string
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
        <Button onClick={handleSave} disabled={saving || inputValue.trim() === ''}>
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
```

- [ ] **Step 2.2 — Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2.3 — Commit**

```bash
git add src/components/settings/baseline-form.tsx
git commit -m "feat(baseline-settings): BaselineForm client component (input + 保存 + 清空 + 用自动值)"
```

---

## Task 3: `/settings/baseline` RSC page

**Files:**
- Create: `src/app/settings/baseline/page.tsx`

- [ ] **Step 3.1 — Implement page**

Write `src/app/settings/baseline/page.tsx` with EXACTLY:

```typescript
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { BaselineForm } from '@/components/settings/baseline-form';

const MIN_RETROS_FOR_MEDIAN = 3;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

const SOURCE_LABEL = {
  null: '尚未设置',
  onboarding: '你 onboarding 填的',
  'retro-median': '自动从复盘 median 算出',
} as const;

export default async function BaselineSettingsPage() {
  const user = await getOrCreateDefaultUser();
  const [fresh, metrics] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { baselinePlays: true },
    }),
    prisma.actualMetric.findMany({
      where: { analysis: { userId: user.id } },
      select: { plays: true },
    }),
  ]);

  const retroCount = metrics.length;
  const retroMedian =
    retroCount >= MIN_RETROS_FOR_MEDIAN
      ? Math.round(median(metrics.map((m) => Number(m.plays))) ?? 0)
      : null;

  const initialValue = fresh?.baselinePlays?.toString() ?? null;
  const currentLabel =
    initialValue === null
      ? SOURCE_LABEL.null
      : retroMedian !== null && Math.round(retroMedian) === Number(initialValue)
        ? SOURCE_LABEL['retro-median']
        : SOURCE_LABEL.onboarding;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">账号基线</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          这是 L1 预测的核心输入。 表达你账号"一条普通视频通常多少播放"。
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4 text-sm">
        当前: <b>{initialValue ?? '—'}</b>
        {initialValue !== null && ' 播放/视频'} ({currentLabel})
      </div>

      <BaselineForm
        initialValue={initialValue}
        retroMedian={retroMedian}
        retroCount={retroCount}
      />
    </div>
  );
}
```

- [ ] **Step 3.2 — Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3.3 — Commit**

```bash
git add src/app/settings/baseline/page.tsx
git commit -m "feat(baseline-settings): /settings/baseline RSC page (reads baseline + retro median)"
```

---

## Task 4: PredictionCard 改造 — 加跳转 Link

**Files:**
- Modify: `src/components/content/prediction-card.tsx`

- [ ] **Step 4.1 — Add Link import**

打开 `src/components/content/prediction-card.tsx`, 在文件顶部 imports 区加:

```typescript
import Link from 'next/link';
import { Button } from '@/components/ui/button';
```

(已经 import 了 `cn`、`formatPlays`、`Card`/`CardContent`、type — 保留, 加 Link 和 Button)

- [ ] **Step 4.2 — Fallback 态加 CTA 按钮**

找到现有 fallback 块:

```typescript
  if (!data) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">💡 L1 播放预测暂未生成</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• 设了账号基线 → 上传时立即出预测</li>
            <li>• 没设的话, 等 3 条复盘后会自动从实测数据反算出基线</li>
          </ul>
        </CardContent>
      </Card>
    );
  }
```

把这个完整块替换为:

```typescript
  if (!data) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">💡 L1 播放预测暂未生成</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• 设了账号基线 → 上传时立即出预测</li>
            <li>• 没设的话, 等 3 条复盘后会自动从实测数据反算出基线</li>
          </ul>
          <Link href="/settings/baseline">
            <Button size="sm" variant="outline">设置基线 →</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }
```

- [ ] **Step 4.3 — 数据态底部加修改 link**

找到现有数据态最末 div:

```typescript
        <div className="text-center text-xs text-muted-foreground">
          基线 {formatPlays(data.basisValue)} ({SOURCE_LABEL[data.basisSource]})
        </div>
```

替换为:

```typescript
        <div className="text-center text-xs text-muted-foreground">
          基线 {formatPlays(data.basisValue)} ({SOURCE_LABEL[data.basisSource]}) ·{' '}
          <Link href="/settings/baseline" className="hover:text-primary underline-offset-2 hover:underline">
            修改 →
          </Link>
        </div>
```

- [ ] **Step 4.4 — Typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: 0 typecheck errors, all tests pass (no test changes).

- [ ] **Step 4.5 — Commit**

```bash
git add src/components/content/prediction-card.tsx
git commit -m "feat(baseline-settings): PredictionCard fallback + 数据态 加 /settings/baseline Link"
```

---

## Task 5: 手动 E2E 验收

**No code changes** — 跑 spec §6.3 的 4 个场景。

- [ ] **Step 5.1 — 清空 baseline 准备冷启动**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
UPDATE \"User\" SET \"baselinePlays\" = NULL WHERE id = 'default-user';
-- 同时清掉 L1 阶段注入的 mock predictedPlaysRange, 让 fallback 触发
UPDATE \"ContentAnalysis\"
SET report = report - 'predictedPlaysRange'
WHERE id = '71c5b679-244';
SELECT \"baselinePlays\" FROM \"User\";
"
```

Expected: `baselinePlays | NULL`.

- [ ] **Step 5.2 — 跳转测试**

1. 打开 `http://localhost:3000/content/preflight/71c5b679-244`
2. PredictionCard 应该是 fallback 态, 显示 "💡 L1 播放预测暂未生成" + 按钮 "设置基线 →"
3. 点击按钮 → 跳到 `http://localhost:3000/settings/baseline`
4. 页面显示 "当前: — (尚未设置)", 没有 retro median 部分 (因为 retroCount=0)

- [ ] **Step 5.3 — 设置 baseline**

1. 在 `/settings/baseline` 输入框填 `800`
2. 点 "保存" → 看到 "已保存: 800" 绿色提示
3. 页面顶部 "当前" 行刷新为 "当前: 800 播放/视频 (你 onboarding 填的)"
4. SQL 验:
   ```bash
   docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "SELECT \"baselinePlays\" FROM \"User\";"
   ```
   Expected: 800

- [ ] **Step 5.4 — 修改 link 验证**

1. 回到 `http://localhost:3000/content/preflight/71c5b679-244`
2. PredictionCard 此时仍是 fallback (这条 analysis 没有重新跑 worker, 报告里没 predictedPlaysRange) — 这是预期的, 因为 prediction 是在 analysis 创建时算的, 不是 page-load 时算的
3. (要真正验证数据态的修改 link, 需手动注入 mock predictedPlaysRange:)
   ```bash
   docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
   UPDATE \"ContentAnalysis\"
   SET report = report || '{\"predictedPlaysRange\": {\"predicted\": 677, \"lower\": 339, \"upper\": 1354, \"confidence\": \"low\", \"basisSource\": \"onboarding\", \"basisValue\": 800}}'::jsonb
   WHERE id = '71c5b679-244';
   "
   ```
4. 刷新报告页 → PredictionCard 数据态, 底部小字应该有 "修改 →" link
5. 点击 → 跳 `/settings/baseline`, input 预填 800

- [ ] **Step 5.5 — Retro median 提示 (mock)**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
-- 注入 3 条 retro
INSERT INTO \"ContentAnalysis\" (
  id, \"userId\", \"videoPath\", \"videoFilename\", \"videoSizeBytes\", \"videoDurationSec\", \"videoMimeType\",
  niche, status, \"retryCount\", report, \"llmUsage\",
  \"douyinUrl\", \"douyinAwemeId\", \"publishedAt\", \"retroStatus\", \"retroReport\",
  \"createdAt\", \"updatedAt\", \"completedAt\", \"retroCompletedAt\"
) VALUES
  ('bs-test-1', 'default-user', '/x', 'mock.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 70}'::jsonb, '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '5 days', 'COMPLETED',
   '{\"hookGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW(), NOW(), NOW(), NOW()),
  ('bs-test-2', 'default-user', '/x', 'mock.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 70}'::jsonb, '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '4 days', 'COMPLETED',
   '{\"hookGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW(), NOW(), NOW(), NOW()),
  ('bs-test-3', 'default-user', '/x', 'mock.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 70}'::jsonb, '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '3 days', 'COMPLETED',
   '{\"hookGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW(), NOW(), NOW(), NOW());

INSERT INTO \"ActualMetric\" (id, \"analysisId\", \"daysAfterPublish\", source, plays, likes, comments, shares, collects)
VALUES
  ('bs-m-1', 'bs-test-1', 3.0, 'douyin-creator-center', 500, 10, 2, 1, 5),
  ('bs-m-2', 'bs-test-2', 3.0, 'douyin-creator-center', 900, 20, 4, 2, 10),
  ('bs-m-3', 'bs-test-3', 3.0, 'douyin-creator-center', 1300, 30, 6, 3, 15);
"
```

1. 刷新 `/settings/baseline` → 应该看到 "📊 自动计算 (基于 3 条复盘 median): 900" + "用自动值" 按钮
2. 点 "用自动值" → input 填入 900
3. 点 "保存" → User.baselinePlays = 900
4. 底部黄底 "💡 ≥3 条复盘时..." 应该可见
5. 当前行刷新为 "当前: 900 播放/视频 (自动从复盘 median 算出)"

- [ ] **Step 5.6 — 清空 button 验证**

1. 在 `/settings/baseline` 点 "清空 (回到冷启动)"
2. 弹 confirm "确认清空 baseline?", 点确认
3. input 清空, 显示 "已清空, 回到冷启动态"
4. 顶部 "当前" 显示 "尚未设置"

- [ ] **Step 5.7 — 清理 mock**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
DELETE FROM \"ActualMetric\" WHERE id LIKE 'bs-m-%';
DELETE FROM \"ContentAnalysis\" WHERE id LIKE 'bs-test-%';
UPDATE \"User\" SET \"baselinePlays\" = 800 WHERE id = 'default-user';
"
```

(保留 800 是为了后续 L1 流程仍有可用 baseline; 你也可以选择留空)

- [ ] **Step 5.8 — 跑全测试 + typecheck**

```bash
npm run typecheck && npm test
```

Expected: 0 typecheck errors, 全部 tests pass (165 + 8 新增 = 173 总数)。

- [ ] **Step 5.9 — Commit (如需要)**

```bash
git status
# 如有清理或微调
git add -A && git commit -m "chore(baseline-settings): E2E acceptance cleanup"
```

---

## 完成标志

- ✅ Task 1-4 commit 全部完成
- ✅ Task 5 E2E 5 个场景通过 (fallback CTA, 设置, 修改 link, retro median 提示, 清空)
- ✅ `npm run typecheck` 0 错
- ✅ `npm test` 全绿 (含 8 个新 API 测试)
- ✅ 浏览器 `/settings/baseline` 渲染 + 3 个按钮工作

→ Sub-project A 完成, 进入 Sub-project B (PredictionHistory + Dashboard L1 趋势 widget) 的 brainstorm。

---

## 自审记录 (writing-plans self-review)

**Spec 覆盖**:
- §2 architecture (API + RSC + form + PredictionCard 改造) → Task 1 / 3 / 2 / 4 全覆盖
- §3 data model (无变更) → 无需 task
- §4 UX (layout + 3 按钮 + retro median 提示) → Task 2 (form) + Task 3 (page)
- §5 API contract (PUT valid/null/400 cases) → Task 1 单测
- §6 testing (8 个 API 单测 + 4 个 E2E 场景) → Task 1 + Task 5
- §7 错误处理 (网络/非法/Prisma) → Task 1 实现 + Task 2 form catch

**Placeholder scan**: 无 TBD/TODO。 所有 step 都含完整代码或具体命令。

**Type consistency**:
- `BaselineForm` props `{ initialValue, retroMedian, retroCount }` Task 2 定义, Task 3 RSC 使用一致。
- `User.baselinePlays` BigInt? 全程 `.toString()` 序列化 (Task 1 API, Task 3 RSC), 反向 `BigInt(Math.round(value))` (Task 1 API)。
- `MAX_BASELINE = 1e8` Task 1 API 校验; Task 2 form input 用 `min={0}` 但不强制上限 (由 API 兜底), 一致。
- PredictionCard 接受 `PredictedPlaysRange | null | undefined` 不变, Task 4 只加 Link 不改 prop 类型。

无 inconsistency。
