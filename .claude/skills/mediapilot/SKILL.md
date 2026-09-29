---
name: mediapilot
description: 用 mp 命令行操作 MediaPilot 做一条抖音口播: 找选题、建项目、和编导磨稿、定稿、出片、发布文案、关联作品、复盘。触发词:"找个选题做一条"、"帮我做一条视频"、"看看今天的爆款"、"这条复盘怎么样"、"推进 X 项目"。
---

# MediaPilot 全流程

所有操作用 `npm run -s mp -- <命令>`(需要结构化结果时加 `--json`)。先 `npm run -s mp -- help` 看全部命令。设计: `docs/superpowers/specs/2026-09-29-agent-cli-design.md`。

## 流程(按顺序, 标 ⏸ 的地方必须停下等用户)

1. **看状态**: `mp status`。回采/巡检失败先告诉用户原因与补救。
2. **找选题**: `mp topics suggest`(或 `mp topics hits` → `mp topics show <作品>`)。把 3 个选题简短列给用户。⏸ 用户选定。
3. **建项目**: 选题来自对标作品就 `mp project new --from-video <作品>`, 否则 `mp project new --title <标题>`。
4. **磨稿**: `mp chat <项目> "<用户要的方向>"`。看工具结果:
   - 有"照抄对标原句"→ `mp chat <项目> "把照抄的句子换成我的说法"`;
   - 超时 → 让编导按提示压缩。
   然后 `mp project show <项目>` 把稿子给用户看。⏸ 用户确认后 `mp script finalize <项目>`。
5. ⏸ **录口播**: 告诉用户在项目页「② 口播」用提词器录、上传; 转写完成后再继续(`mp project show` 显示"已转写 N 句")。
6. **出片**: ⏸ 先问用户要不要现在出片, 同意后按 `produce-film` skill 做。
7. **发布**: `mp publish kit <项目>` 把标题/话题/封面字给用户; 用户自己在抖音发。
8. **关联**: 第二天 `mp publish candidates`; 用户确认后 `mp publish link <项目> <作品>`(或用户给的链接)。
9. **复盘**: 第 3 天后 `mp retro show <项目>`。写法经验候选 ⏸ 由用户决定, 再 `mp lessons adopt|reject <经验>`。

## 规矩

- 不替用户做决定: 选题、定稿、出片、采纳经验都等用户开口。
- 不编数据: 只引用命令输出。
- 访问抖音的命令(`topics paste/analyze/search`、`tasks run`)用的是用户大号: 只在用户要求时用, 受每日额度限制。
- 命令失败时把 message 原样告诉用户(它已经写了原因和怎么办)。
