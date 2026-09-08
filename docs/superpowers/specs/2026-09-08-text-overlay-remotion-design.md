# 三十七期设计：文字叠加层的 Remotion 回归（关键词大字 + 常驻角标）

## 一、要解决什么

用户拿参考片（`13432407405416226.mp4`，真人口播 + 蓝色关键词大字 + 底部字幕 +
右上角声明角标）问「对应哪个模板」——对应「真人口播·文字叠加」，且该模板的描述
与参考片角标逐字相同，当初就是对标它建的。但用户实际用这个模板出片**没有那个
效果**：文字叠加层随旧渲染引擎在三十期一起下线，一直没搬进 Remotion。模板名叫
「文字叠加」，缺的恰好是文字叠加。

两层缺口：
1. **关键词大字层**（骨架）：蓝大字/白中字/箭头，跟内容逐段出现，竖排推导。
2. **常驻角标**：右上角三行声明小字，全程常驻。

## 二、考古结论：这是复活+移植，不是从零造

旧链的完整实现躺在 git 历史（`c48348b^`）里，且当初的参考片拆解 spec 还在
（`docs/superpowers/specs/2026-08-29-talking-head-overlay-style.md`，对标的就是
同一类视频）：

- **提取 prompt**（`src/lib/llm/prompts/overlay-plan.ts`，127 行）：三种元素
  （keyword ≤14 字蓝大字 / note ≤12 字白中字 / arrow 箭头）、五格竖排
  （left-1~5 + top/bottom-center）、五条硬规则（绝不抄字幕原句 / 一屏最多 3 元素 /
  同格不重叠 / 停留到讲完 / 过渡句不叠字）。**几乎原样复活**。
- **格位与安全区**（`src/lib/video-production/overlay-plan.ts`）：`textSafeZone`
  按画幅+版面+`personSide` 算安全区，放不下时槽位回退。**排版思想复活**，
  实现从 ffmpeg drawtext 坐标改为 Remotion 组件。
- 渲染端 `applyTextOverlay`（ffmpeg 滤镜链）不复活——渲染重写为 Remotion 层。

用户已拍板：**AI 提取 + 剪辑台可改**（与分镜同一套哲学：模型草案、人终审）。

## 三、分层设计

### 3.1 数据：OverlayPlan 与 FilmPlan 平级

- `VideoProduction` 加可空 Json 列 `overlayPlan`：
  `{ items: [{ kind: 'keyword'|'note'|'arrow', text: string(≤14), slot: 'left-1'..'left-5'|'top-center'|'bottom-center', startMs, endMs }] }`
- zod：`OverlayPlanSchema`（新建 `src/lib/video-production/overlay-plan.ts`，
  常量与 schema 从历史版考古搬回，`.strict()` 全层，`items` 0~40 条）。
- **不塞进 FilmPlan**：分镜是「片段时间窗+卡片」，叠加是全片时间轴上的独立层，
  语义不同；README 三十三期就记过常驻层需要独立于 shots 的结构。两个 Json 列
  并排，删任务时一起没，无失效不对称。

### 3.2 提取（worker，talking-head 链）

- 时机：转写完成后（已有逐句 segments）、`template.textOverlayEnabled` 开启时，
  在生成分镜的同一阶段调一次 LLM（deepseek-chat）产出 overlayPlan 草案落库。
- prompt 从历史版复活，校验失败走既有修复循环机制（`formatIssuesForModel` 同款
  措辞纪律；一轮修不好就落**空 items** 并在 productionNotice 记一句——叠加层
  缺失不该拦整条片）。
- 只对 `talking-head-broll` 链跑（参考形态是口播；其它链先不做，YAGNI）。

### 3.3 渲染（Remotion）

- `FilmInput` 加 `overlays?: OverlayItem[]`、`overlayPersonSide?: 'left'|'center'|'right'`、
  `cornerBadge?: string | null`（同形不 import 惯例）。
- 新组件 `remotion/src/overlay/TextOverlayLayer.tsx`：
  - 格位→坐标：纯函数 `overlaySlotRect(aspect, personSide, slot)`（考古
    `textSafeZone` 的思想：人在右→格子在左半，竖屏→格子在上方；放不下回退）。
    纯函数可单测。
  - keyword：蓝大字（`theme` 系色 + 描边），进场用 `anim.ts` 的 `smashIn`；
    note：白中字 `fadeUp`；arrow：`↓` `fadeUp`。**动效一律走 anim.ts 纯函数**。
  - 层级：在人物视频之上、字幕之下。
- 角标 `cornerBadge`：常驻右上角小字（支持 `\n` 多行），无动效，恒显。
- 合成位置：`Film.tsx` 顶层加一个 `<TextOverlayLayer>`（cutaway 的卡片段照常
  盖在上面——卡片出现时叠加层被卡片自然遮住，与参考片行为一致，不做额外避让）。

### 3.4 注入与模板参数复活

- worker 渲染时读 `vp.overlayPlan` + `template.personSide` + `template.cornerBadge`
  填入 FilmInput（renderFilm 与 still/体检同注入，惯例照三十六期 templateStyle）。
- 模板编辑器：`textOverlayEnabled` 与 `personSide` **从「旧版遗留」折叠区搬回**
  「真人形象与文字叠加」节（hint 重写：说明 AI 提取+剪辑台可改）；新增
  `cornerBadge` 多行文本框（空 = 不显示；默认建议填模板描述那三行）。
- `VideoTemplate` 加列 `cornerBadge String?`。
- 演示指纹 `templateDemoHash` 算入 `textOverlayEnabled/personSide/cornerBadge`；
  演示脚本给出镜模板的演示带一组固定示例 overlays（展示这层长什么样）。

### 3.5 剪辑台

- workbench 在 plan_ready 时新增「文字叠加」区（分镜缩略图条之下）：逐条列出
  items（kind 徽章 + text 输入 + slot 下拉 + 起止秒），可改/删/加一条。
- 保存走新接口 `PATCH /api/v1/cockpit/video-productions/[id]/overlay-plan`
  （全量替换，zod 校验，机制照 film-plan PATCH）。
- Player 预览带 overlays——改完立刻看到（与样式面板同为实时预览消费者）。
- 拖拽定位**不做**（三十四期拖拽期统一做，格位下拉够用）。

## 四、测试

1. `overlaySlotRect` 纯函数单测：人在右→格在左、竖屏→格在上、slot 回退。
2. 提取 schema 门：合法通过 / text 超 14 字拒 / 未知 slot 拒 / `.strict()` 多键拒。
3. 真渲染 A/B + 变异：同一帧带 overlays vs 不带，逐像素差分非零；
   `TextOverlayLayer` 短路后归零转红（判据沿用同时刻/同内容/互比铁律）。
4. cornerBadge：带 vs 不带差分非零（角标区）。
5. worker 注入与 PATCH 校验各一组 API 测试。

## 五、不做的（YAGNI）

- 非口播链的叠加（图文口播画面本来就是卡片）。
- 叠加元素新类型（沿用 keyword/note/arrow 三种，拆解 spec 论证过够用）。
- 画布拖拽定位（并入三十四期拖拽期）。
- 角标样式配置（位置/颜色固定右上小字，先上）。

## 六、风险

- **提取质量**：旧 prompt 有实拍验证痕迹但没有本仓的实测数据。上线路径与分镜
  一致（AI 草案 + 人终审），最坏情况=剪辑台里手改，不阻塞。
- **与字幕/卡片打架**：bottom-center 格与字幕冲突——prompt 里已有「谨慎用」，
  渲染端再把 bottom-center 的 y 抬到字幕安全区之上（复活 caption-safe-zone 思想）。
- **Prisma 新列旧 client**：改 schema 重启 dev+worker（既有纪律）。
