# Baseline Settings Page Design Spec

**Status:** Draft 2026-06-15
**Owner:** MediaPilot (solo dev)
**Phase:** L1 Prediction v2 — Sub-project A

## 1. Goal & Scope

让用户在 GUI 修改 `User.baselinePlays`, 而不用直连 DB。 入口从 PredictionCard 进。

**In scope:**

- 新建 `/settings/baseline` mini 设置页 (RSC + 1 个 client 表单组件)
- 新建 `PUT /api/v1/user/baseline` (写入/清空 User.baselinePlays)
- 改 `PredictionCard` — fallback 态从纯文字变可点击按钮; 数据态加"修改"小链接
- 显示 retro median (若 ≥3 条) 作为 "用自动值" 一键填入提示

**Out of scope (留 v3):**

- 通用 `/settings` index 页 (现阶段只 baseline 一项)
- baseline 模式切换器 (auto vs manual 锁定)
- 完整 toast/通知系统 (用最简单的 `<p>` 状态提示)

## 2. Architecture

```
[ /content/preflight/[id] ]
       │
       ▼
[ PredictionCard ]
   - fallback 态 → [设置基线 →] 按钮 (Link href="/settings/baseline")
   - 数据态 → 底部小字"修改 →" Link
       │
       ▼
[ /settings/baseline ]   ← RSC: 服务端读 User.baselinePlays + retro median
       │ 渲染 <BaselineForm initialValue={..} retroMedian={..} retroCount={..} />
       ▼
[ BaselineForm — client ]
   - input + 保存 + 清空 + "用自动值" 按钮
   - 调用 PUT /api/v1/user/baseline
       │
       ▼
[ PUT /api/v1/user/baseline ]
   Body: { value: number | null }
   - value === null → User.baselinePlays = null
   - value > 0 && ≤ 1e8 → User.baselinePlays = BigInt(value)
   - 其他 → 400
   - 写后 return ok({ baselinePlays: string|null })
```

**Key files:**

| File | Responsibility |
|---|---|
| `src/app/settings/baseline/page.tsx` | RSC: 读 User + retro median, 传 props 给 BaselineForm |
| `src/components/settings/baseline-form.tsx` | Client: input + 3 个按钮 + PUT 调用 |
| `src/app/api/v1/user/baseline/route.ts` | PUT handler — 校验 value, 写 User |
| `src/components/content/prediction-card.tsx` (modify) | Fallback CTA 加 Link 跳转; 数据态加"修改"链接 |

## 3. Data Model

无新表 / 无新列。 复用 `User.baselinePlays BigInt?`。

## 4. UX 详细

### 4.1 Page Layout

```
┌──────────────────────────────────────────────────────┐
│  账号基线                                              │
│                                                      │
│  当前: 800 播放/视频 (你 onboarding 填的)               │
│  ──────────────────────────────────────              │
│  📊 自动计算 (基于 5 条复盘 median): 720               │
│  [ 用自动值 ]   ← 一键填到 input                       │
│  ──────────────────────────────────────              │
│                                                      │
│   播放数: [ 800       ]                              │
│                                                      │
│   [ 保存 ]   [ 清空 (回到冷启动) ]                     │
│                                                      │
│   💡 ≥3 条复盘时, 新分析自动用 retro median,           │
│     这里写的值会在下次复盘时被覆盖。                    │
└──────────────────────────────────────────────────────┘
```

### 4.2 RSC 数据获取

`page.tsx` 读三件事:

1. `User.baselinePlays` (当前值)
2. 从 `User` 关联的 `ActualMetric.plays` 数组算 median (若 ≥ 3 条; 否则 null)
3. retro count (条数, UI 展示用)

直接 reuse `src/lib/prediction/baseline.ts` 的 median 计算? 不直接调 — `resolveBaseline` 有 writeback 副作用。 RSC 里只读, 用单独的纯函数算 (或 inline)。

### 4.3 BaselineForm 客户端逻辑

`'use client'` 组件, props: `{ initialValue: string | null; retroMedian: number | null; retroCount: number }`

State:
- `inputValue: string` (受控 input)
- `saving: boolean`
- `message: { type: 'success' | 'error'; text: string } | null`

按钮:
- **保存** — 校验 input 是数字 + > 0 + ≤ 1e8 → PUT `{ value: Number(inputValue) }`; 否则 inline 错误
- **清空** — PUT `{ value: null }`, input 清空, message 成功
- **用自动值** — `setInputValue(retroMedian.toString())` (仅前端,需点保存才生效)

### 4.4 PredictionCard 改造

**Fallback 态** (data == null):
```tsx
<Card>
  <CardContent>
    <h3>💡 L1 播放预测暂未生成</h3>
    <ul>...</ul>
    <Link href="/settings/baseline">
      <Button size="sm" variant="outline">设置基线 →</Button>
    </Link>
  </CardContent>
</Card>
```

**数据态** (data ≠ null):
底部 basis 那行加 link:
```tsx
基线 800 ({SOURCE_LABEL[data.basisSource]}) ·
<Link href="/settings/baseline" className="hover:text-primary">修改 →</Link>
```

## 5. API Contract

### `PUT /api/v1/user/baseline`

**Request Body:**
```json
{ "value": 800 }       // 设置/更新
{ "value": null }      // 清空
```

**Validation:**
- `value === null`: 通过
- `typeof value === 'number' && isFinite(value) && value > 0 && value <= 1e8`: 通过 (round 后写入)
- 其他: 400 fail("baselinePlays 必须是 0 < value ≤ 1e8 的数字, 或 null")

**Response (200):**
```json
{ "success": true, "data": { "baselinePlays": "800" }, "message": "ok" }
```
(baselinePlays 仍然是 BigInt → 字符串序列化)

**Response (400 / 500):** 标准 fail() shape

## 6. Testing

### 6.1 API 单测 (`tests/api/user/baseline.test.ts`)

- ✓ `PUT { value: 800 }` → 200, success, data.baselinePlays === "800"
- ✓ `PUT { value: null }` → 200, baselinePlays === null
- ✓ `PUT { value: 0 }` → 400
- ✓ `PUT { value: -1 }` → 400
- ✓ `PUT { value: 1e9 }` → 400 (超过 1e8 上限)
- ✓ `PUT { value: "abc" }` → 400 (typeof check 失败)
- ✓ `PUT { value: NaN }` → 400 (isFinite 失败)
- ✓ Prisma 报错 → 500

### 6.2 不写单测
- BaselineForm UI (client component, 走 E2E)
- RSC page.tsx (走 E2E)

### 6.3 手动 E2E

1. **设置 baseline:**
   - 清空 baseline (`UPDATE "User" SET "baselinePlays" = NULL`)
   - 打开任一 analysis 报告页 → PredictionCard fallback 显示 [设置基线 →]
   - 点击 → 跳到 `/settings/baseline`
   - 输入 800 → 保存 → 提示成功
   - 回到原 analysis report (刷新) → PredictionCard 显示具体区间

2. **清空 baseline:**
   - 在 `/settings/baseline` 点 "清空" → DB 回到 null

3. **修改链接:**
   - PredictionCard 数据态底部 "修改 →" 点击 → 跳 `/settings/baseline`,input 预填当前值

4. **Retro median 提示 (需 mock):**
   - 用 Phase 3 mock SQL 注入 3 条 retro
   - 打开 `/settings/baseline` → 看到 "自动计算 (基于 3 条复盘 median): X" + 按钮
   - 点 "用自动值" → input 填入 X
   - 保存 → User.baselinePlays = X
   - 提示 "≥3 条复盘时, 新分析自动用 retro median" 应可见

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 网络失败 | BaselineForm catch → message='error', text=err.message |
| 非法 value | API 400 → BaselineForm 显示 server message |
| Prisma update 失败 | API 500 → BaselineForm 显示 "保存失败: ..." |
| User 不存在 (理论不可能, default-user 总在) | API 500 |

## 8. 完成标志

- ✅ `/settings/baseline` 可访问, 渲染当前 + retro median
- ✅ 保存/清空/用自动值 三个按钮工作
- ✅ PredictionCard 两态都能跳转 `/settings/baseline`
- ✅ API 8 个单测通过
- ✅ typecheck 0 错, npm test 全绿
