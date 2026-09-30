# 三十六期设计：模板级样式预设

## 一、要解决什么

样式三参数（强调色 `accent`、动效速度 `speed`、缩放 `scale`）目前只能在剪辑台**逐镜**调。
模板层没有默认值——想让某个模板出的片全部走红色强调，只能每条片每一镜手动改一遍。

用户的期望模型（三十五期原话转述）：模板是一个可视化预设包，**在模板里改预设，
之后用它出的片就按预设走**；剪辑台仍可逐镜覆盖。

范围裁定（已与用户确认）：**只做样式预设**。「卡片偏好/禁用某些卡」动的是选卡
提示词（模型行为，需实测），是另一种机制，另立一期。

## 二、方案：渲染时合并（已与用户确认）

模板存一份默认样式；渲染每一镜时，镜上显式设置的字段用镜的，没设的用模板默认。

**为什么不在发起出片时把默认拍进每镜（方案 B）**：改模板对已建任务无效，违背
「随时改预设、效果跟着变」的期望；且剪辑台从此分不清「默认」与「手动设过」，
「恢复跟随模板」变得不可能。方案 C（剪辑台打开时填充）同病。

合并语义：**逐字段**。`有效样式 = { ...模板默认, ...镜上显式 }`——
镜只覆盖了颜色时，速度与缩放仍跟模板。

## 三、分层设计

### 3.1 数据（真源：`prisma/schema.prisma` + `src/lib/video-template/model.ts`）

- `VideoTemplate` 加可空 Json 列 `defaultShotStyle`。
- 校验**复用** `src/lib/video-production/shot-plan.ts` 的 `ShotStyleSchema`
  （`speed 0.3~3 / accent enum(default|blue|yellow|red) / scale 0.6~1.6`，全字段
  optional，`.strict()`）——模板默认与逐镜覆盖是同一个类型，不另造第二份 schema。
- `VideoTemplateConfig` 加 `defaultShotStyle: ShotStyle | null`；
  GET/PUT/duplicate 三条模板 API 带上它（duplicate 必须复制）。
- **改 schema 后必须重启 dev 与 worker**（本仓已知坑：旧 client 把新字段读成
  undefined 而不报错）。

### 3.2 渲染合并（唯一合并点：`remotion/src/Film.tsx`）

- `FilmInput` 加可选 `templateStyle?: ShotStyle`
  （两侧同形不 import，惯例同 `CaptionItem`；`src/lib/video-production/remotion-render.ts`
  与 `remotion/src/Film.tsx` 两处都加）。
- `Film.tsx` 第 218 行渲卡处改为传合并值：
  `style={{ ...templateStyle, ...s.style }}`。
- **九张卡组件零改动**；`cards/style.ts` 的 `speedT/resolveAccent/scaleStyle` 零改动。
- 合并抽成纯函数 `mergeShotStyle(templateStyle, shotStyle)` 放
  `remotion/src/cards/style.ts`，供 Film.tsx 与剪辑台面板显示共用 + 可单测。
  （undefined 字段不得覆盖已有字段——`{...a, ...b}` 的展开语义里 b 的 undefined
  字段键**存在**时会覆盖，实现时必须先剔除 undefined 键，测试要钉这个坑。）

### 3.3 注入点（模板默认从库到渲染输入）

| 消费点 | 改动 |
| --- | --- |
| `video-production-worker.ts` 组装 FilmInput 两处（489/918 附近） | 读 `template.defaultShotStyle` 填 `templateStyle` |
| `remotion-render.ts` 的 `renderShotStill`（剪辑台缩略图/静态卡面） | 调用方（still API）传入 `templateStyle` |
| `film-plan` GET（`api/v1/cockpit/video-productions/[id]/film-plan`） | meta 加 `templateStyle`，剪辑台 Player 预览与面板显示用 |
| `plan-preview.tsx`（Player 双模预览） | inputProps 带 `templateStyle` |
| `scripts/generate-template-demos.ts` | 演示渲染带 `templateStyle`；**指纹函数 `templateDemoHash` 把 `defaultShotStyle` 算进 key**——改默认样式后旧演示自动失效 |

模板默认**不写进 `FilmPlan`**（`stripPlanStyle` 与模型三重隔离原样不动）。

### 3.4 模板编辑器（`template-editor.tsx`）

「画面」节内加「默认样式」子块：
- 强调色：四选（跟随主题默认 / 蓝 / 黄 / 红）
- 速度：滑杆 0.3~3（默认 1）
- 缩放：滑杆 0.6~1.6（默认 1）
- 三项均可「未设置」（null 语义 = 渲染层用各自内建缺省）；显示当前值。
- hint 写明：「这里是默认值，剪辑台可逐镜覆盖；改完保存后，右上效果演示会提示重新生成」。

### 3.5 剪辑台（`film-plan-workbench.tsx` 样式面板）

- 面板从 film-plan GET 的 `templateStyle` 拿到模板默认。
- 每个控件的缺省态显示「跟随模板（当前：×）」；用户一动就变成显式覆盖
  （写进 `shot.style`，保存进 FilmPlan——现状机制不变）。
- 每项加「恢复跟随」小按钮 = 从 `shot.style` 删掉该字段。
- 面板顶部原「与渲染层缺省值逐条对齐」的注释要更新：初始显示值现在来自
  `mergeShotStyle(templateStyle, {})`。

## 四、测试

1. `mergeShotStyle` 单测：逐字段合并；**undefined 不覆盖**（钉 3.2 的坑）；两侧都空返回 {}。
2. 真渲染 A/B + 变异：同一镜，模板默认 accent=red vs 无默认，逐像素差分必须非零；
   把 Film.tsx 的合并改回 `s.style` 直传（变异），差分归零 → 测试转红。
   判据沿用三十三期立的规矩：同一时刻、内容一致、逐像素互比。
3. 模板 API 往返：PUT 带 defaultShotStyle 落库、GET 读回、duplicate 复制、
   非法值（speed=5）400。
4. film-plan GET 返回 templateStyle；模板没设时为 null。
5. 指纹：defaultShotStyle 变 → `templateDemoHash` 变。

## 五、不做的（YAGNI）

- 卡片偏好/禁用卡型（另一期，动提示词）。
- per-卡型的默认样式（如「stat 卡默认黄、curve 默认蓝」）——先上全局三参数，
  真用出需求再说。
- 剪辑台「一键把当前镜样式存回模板默认」——反向通道，等要了再做。

## 六、风险

- **展开语义坑**（3.2）：测试第一条专门钉。
- **Prisma 新字段旧 client**：改 schema 后不重启 worker，模板默认会静默读成
  undefined——症状是"配了没效果"，极难排查。计划里把重启写成显式步骤。
- 剪辑台「跟随模板」态引入第三种状态（undefined vs 显式同值），UI 若只显示值
  不显示来源，用户会以为没生效——3.5 的「跟随模板（当前:×）」文案是硬要求。
