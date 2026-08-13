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

## 6. 实际实施结论（T1-T6 落地后回写，2026-08-14）

设计文档写于实施前，以下是与草稿假设有出入、或草稿未覆盖、需要落盘存档的实际决策，逐条对应 `.superpowers/sdd/2026-08-14-xhs-image-generation/task-*-report.md` 里的记录：

**(a) idx 字段匹配双侧校验——T3 修复轮，"LLM 输出顺序不可信"的教训**：草稿 §1 只说了 `imagePlan.images` 每个元素带 `idx` 字段，未强调数组顺序与 `idx` 字段可能不一致。T3 初版消费侧（`images/route.ts`）用 `imagePlan.images[idx].prompt` 数组下标直接取值，审查发现一旦 LLM 输出顺序与 idx 错位（如返回 `[{idx:2},{idx:0},{idx:1}]`），客户端请求 `idx=0` 会**静默**拿到 idx=2 那张的 prompt——不报错、不出提示，纯粹生成一张错的图。修复分两层：①消费侧改 `imagePlan.images.find(img => img.idx === idx)` 按字段匹配，找不到统一按"idx 越界"处理（400，文案「出图计划中没有第 N 张」）；②落盘侧（`images/plan/route.ts`）在原有"张数校验"（`length !== expectedCount`）旁新增 idx 完整性校验——把 `idx` 集合成 `Set`，要求 `size === length` 且恰好覆盖 `{0..length-1}`（无重复/无缺失/无跳号），不符直接 502 拒绝落盘，不让错位的计划有机会进数据库。两层校验都不新增文案分支，复用既有的"数量不对，请重试"话术。这是本项目再一次遇到"LLM 数组输出顺序不可信，必须按业务字段而非数组下标消费"的教训，值得作为通用心智记入：**任何 LLM 结构化输出里若元素自带唯一标识字段，消费方一律按字段匹配，禁止假设数组顺序 = 业务顺序**。详见 `task-3-report.md` 修复轮 1。

**(b) 写盘 try/catch 补 500——同一修复轮的 Minor 项**：`images/route.ts` 的 `mkdir`/`writeFile` 最初未包 try/catch，失败时会走 Next.js 默认非结构化 500 页面，与本路由统一的 `fail()` 响应风格不一致。修复后包一层 try/catch，失败返回 `fail('图片写入失败, 请重试', 500)`，且**不进入**后续的 `prisma.scriptDraft.update`——避免写盘失败但数据库仍记了一条指向不存在文件的 `output.images[idx]` 记录（脏数据）。详见 `task-3-report.md`。

**(c) Content-Disposition 用 RFC 5987 编码整个文件名——T4 落地细节**：zip 下载文件名含中文（`<topic>-发布包.zip`），`Content-Disposition` header 用 `filename*=UTF-8''<percent-encoded>` 语法。关键细节：**编码对象是整个文件名字符串**（`${topic}-发布包.zip` 整体 `encodeURIComponent`），而不是只编码 `topic` 变量部分再拼接未编码的中文字面量 `-发布包.zip`——后者会产出不合规的响应头（RFC 5987 的 `ext-value` 要求非 token 字符全部 percent-encode，中文字面量部分不能漏掉）。单测 `images-archive.test.ts` 显式断言了这个编码结果。详见 `task-4-report.md`。

**(d) `Response(buffer as any)` 类型冲突——沿用仓库既有先例，非本期新造**：zip 二进制响应 `new Response(buffer, {...})` 里 `BodyInit`（lib.dom 类型定义）与 Node `Buffer`/`Uint8Array` 的 TypedArray 泛型参数不兼容，会报 TS 类型错误；尝试过用 `new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)` 转换仍报同类错误（`@types/node` 与 lib.dom 的 TypedArray 泛型定义天然冲突，非本项目配置问题）。最终对齐仓库里唯一的同类先例 `content/analyses/[id]/cover/[idx]/route.ts`（同样 `buf as any`），`archive/route.ts` 头部注释里写明了这层类型冲突的成因与先例援引，避免后来者以为是随手加的 `any`。

**(e) `ImageGenConfig` 死模型未动——按 spec 走 `AIConfig` 泛化表，未触碰专用模型**：`prisma/schema.prisma` 里已存在一个独立的 `ImageGenConfig` 模型（`provider: ImageProvider` 枚举 + `modelId` + `baseUrl` 等字段，形状上明显是为"多生图厂商、自定义网关"设计的专用表），但**没有任何代码引用它**——T1 严格按本文档 §3 的决策（"走既有 AIConfig 体系新增 provider `gpt-image`"）实现，key 解析、设置卡、连通性测试全部复用泛化的 `AIConfig`（`provider` 是字符串而非枚举），`ImageGenConfig` 保持原样未删除也未接入。这是一处已知的模型冗余（两套生图配置模型并存），T1 report 里已记录并建议：若未来真要支持自定义网关/多生图厂商（`ImageGenConfig.baseUrl` 暗示的场景），需要先在 `AIConfig` 泛化路线与 `ImageGenConfig` 专用路线之间做一次选型，而不是两条路都留着；本期严格遵照 spec 决策不越权处理，`ImageGenConfig` 留作后续候选清理项（同 README §9「遗留清理候选」的记账方式）。

**(f) `ai-provider-card.tsx` 文案顺手修——补六期遗留账本，非生图新引入的问题**：T5 走查时发现设置卡「测试」按钮对非 openai provider（`deepseek`/`gpt-image`）会打后端 `/api/v1/ai/config/test`，但该路由目前只实现了 openai 的连通性探测，其余一律 400 兜底拒绝，前端把这句生硬拒绝原样显示，容易被用户误读成"保存失败"。这**不是生图新引入的 bug**——deepseek 用户此前测试同样会撞上这句话，只是六期收尾时没顺手修。T5 借着新增 `gpt-image` provider 的机会一并修掉：前端对非 openai provider 直接短路，不发请求，改显示一句面向用户的中性提示「该服务商暂不支持在线连通性测试，保存后可在实际生成时验证是否可用」；卡片说明文案同时从「配置文本生成用的 AI 服务商 API Key」改为「配置 AI 服务商（文本 / 生图）API Key」，反映新 provider 的存在。

**(g) 真实成图 E2E——用户裁决跳过，验证责任转移给用户配 key 后自验**：本期真实生图需要用户自己的 OpenAI 官方 key（§3 已注明"无 env 回退"），收尾时用户尚未配置该 key，用户明确裁决按 DeepSeek/Tavily 先例降级——**不为跑通真实 E2E 而临时借用/硬凑 key**。已完成的验证：①核心链路（`GptImageProvider`/`resolveImageApiKey`/出图计划 prompt+schema/逐张生图路由/写盘/zip 打包，含上述 (a)(b)(c) 三处边界修复）全部有 mock 单测覆盖，1043 个用例全绿；②T5 用浏览器手工走查了**无 key 的 503 全流程**（引导 toast、并发池 abort、pending 复位、关抽屉重开懒加载恢复缩略图网格的"待生成"态、幂等跳过已有计划只补齐缺张）；③**未覆盖**：实际调用 gpt-image-1 成功出图后的缩略图渲染与"打包下载"点击效果，这部分只做了代码走读确认（`onGenerateImages`/`generateOneImage` 成功分支写 `xhsImages`、`archiveHref` 的出现条件），未做端到端浏览器验证。验证责任转移给用户，配置 key 后自验步骤：① 设置 → 「AI 服务配置」卡保存「OpenAI 生图」provider 的 key；② 打开任意一篇已生成的小红书稿抽屉，点「生成配图」，确认封面 + 各张 shotIdeas 配图逐张渲染出缩略图、命中失败的格子「重试」按钮可用；③ 至少 1 张成图后点「打包下载」，解压确认 zip 内含对应张数的 png + `note.txt`（标题+正文+标签），文件名含中文不乱码。详见 `task-5-report.md`「未覆盖项」与 `task-6-report.md`。
