# 小红书 AI 配图生成（cockpit 七期）

**日期:** 2026-08-14
**背景:** 用户确认产品初衷是「完全不碰拍摄剪辑、AI 出成片」。小红书图文是离该目标最近的形态：六期后文案已全自动，只差配图。本期把 shotIdeas 配图建议变成真图，实现小红书「定稿即成品」。抖音侧免拍路线（AI 数字人口播）留后期，本期不做。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 生图模型 | gpt-image-1（用户指定，已有 OpenAI 官方 key，网络可达）；接口抽象 ImageProvider，单实现起步 |
| 交互 | 一键全生成（封面+全部 shotIdeas，后台逐张、单张失败不影响其余、每张可单独重生成） |
| key 管理 | 走既有 AIConfig 体系新增 provider `gpt-image`（AES 加密+掩码，设置卡保存）；生图客户端硬编码 `https://api.openai.com/v1`，不读 .env 的 OPENAI_BASE_URL（那指向百炼） |
| 成本 | 出图计划 1 次 DeepSeek（几厘）+ 每张 gpt-image-1 约 ¥0.1-0.6（按质量档），单篇全生成约 1-3 元；质量档默认 medium 可配 |

## 1. 生图链路（两步）

```
抽屉小红书面板「生成配图」（一键全生成）
├─ ① 出图计划 POST /api/v1/scripts/[id]/images/plan
│    输入 = intro/body + coverText + shotIdeas（从 ScriptDraft.output 读，非 xhs 稿或缺块 400）
│    DeepSeek 输出（zod）= { style: 全篇统一视觉风格描述(配色/版式/插画风, 英文 token),
│                          images: [{idx, prompt(完整英文图像 prompt, 已融合统一风格)}] }
│    idx=0 为封面：prompt 必须要求把 coverText 原文渲染为海报大字（中文文字入图）
│    idx 1..N 对应 shotIdeas；总数 = 1 + shotIdeas 数，上限 10（成本护栏）
│    存 ScriptDraft.output.imagePlan；已有 imagePlan 时 plan 路由直接返回既有计划（幂等），
│    重新规划需显式 ?force=1
│
└─ ② 逐张生图 POST /api/v1/scripts/[id]/images  body {idx}
     校验：xhs 稿、imagePlan 存在、idx 在范围内
     ImageProvider.generate({prompt, size, quality}) → GptImageProvider
     （POST api.openai.com/v1/images/generations, model gpt-image-1,
      size 1024x1536 竖版≈小红书 3:4, quality 从设置读默认 medium, b64_json 返回）
     写文件 public/generated/<draftId>/<idx>.png（目录不存在则建）
     ScriptDraft.output.images[idx] = { path, prompt, createdAt }（覆盖旧图记录，旧文件覆写）
     响应 ok({ idx, path })
```

前端「一键全生成」：读 imagePlan（无则先调 plan）→ 按并发 2 逐张调 images 路由 → 生成一张渲染一张（缩略图网格）；单张失败该格显示重试按钮；全部完成前「生成配图」按钮 pending；互斥矩阵纳入生图动作（生图中不可改稿/重生成文案）。

## 2. 存储与产出

- 图片本地文件 `public/generated/<draftId>/<idx>.png`（Next.js public 静态可访问，dev/自用足够；云存储 YAGNI）。
- `output.images` 随 ScriptDraft 持久化 → 六期懒加载机制天然恢复（parseDraftOutput 扩展 images 键），关抽屉重开图还在。
- **打包下载**：`GET /api/v1/scripts/[id]/images/archive` → zip（全部 png + note.txt（标题+正文+标签，可直接粘贴发布）），文件名 `<topic>-发布包.zip`。这是「定稿即成品」的落点。
- zip 生成用无依赖方案优先（Node 内建无 zip——允许新增一个轻量依赖如 `archiver` 或 `jszip`，实施时选其一并在 spec 回写记录；这是本项目首次为功能新增运行时依赖，需在 README 记录）。

## 3. 设置与降级

- 设置 → AI 服务配置卡：AI_PROVIDERS 加 `{ id: 'gpt-image', label: 'OpenAI 生图', defaultModel: 'gpt-image-1' }`，key 保存/掩码/加密全走既有机制；连通性测试按钮对该 provider 不支持（同 deepseek 现状，显示提示即可）。
- 质量档：RadarConfig 式单行表？不新建——放 AIConfig.modelId 旁不合适，**放 `ScriptDraft` 生图请求参数**：images 路由 body 可带 `quality?: 'low'|'medium'|'high'`（默认 medium），前端设置卡不做质量项（YAGNI，按钮旁小下拉即可，实施可再简化为固定 medium+代码常量，回写记录）。
- 无 gpt-image key：「生成配图」按钮禁用+引导文案「设置 → AI 服务配置里保存 OpenAI 生图 key」（雷达无 Tavily key 先例）。
- 生图路由 key 解析：新 `resolveImageApiKey(userId)`（AIConfig provider='gpt-image' → decrypt → 无 env 回退——OpenAI 生图 key 没有历史 env 变量，回退直接 null）。

## 4. 不做（YAGNI）

图片编辑/局部重绘/参考图；抖音侧生图与数字人（下期方向）；云存储/CDN；自动发布；批量历史稿补图；设置卡质量档 UI（固定或请求级参数）。

## 5. 风险

| 风险 | 对策 |
|---|---|
| gpt-image-1 中文大字渲染不稳 | 封面 prompt 明确「文字务必准确清晰」；不行就单张重生成（每张 ¥0.x 可承受）；后续可换国产模型（ImageProvider 抽象留好了口） |
| 单张生成 30-60s、全篇几分钟 | 逐张路由+前端并发 2+渐进渲染，不做一个长阻塞请求；Next 路由超时风险隔离到单张粒度 |
| public/generated 膨胀 | 单稿上限 10 张+覆盖重写；清理策略 YAGNI（自用量级） |
| key 泄露面 | AES 加密存储、掩码返回、生图客户端不打日志 prompt 外的任何 key 信息（沿既有纪律） |
| 真实 E2E 花钱 | 收尾真实跑 1 篇（计划+2-3 张图+zip），约 1 元内；其余走 mock |
