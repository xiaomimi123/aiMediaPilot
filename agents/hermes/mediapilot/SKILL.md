---
name: mediapilot
description: 查询用户的抖音创作工具 MediaPilot(对标爆款、复盘、写法经验、任务状态、每日简报)。用户在微信里问"今天有什么爆款/这条复盘怎么样/昨晚回采成功没/写法经验有哪些"时使用。
---

# MediaPilot(微信助手)

MediaPilot 是用户本机的抖音口播创作工具。你只能通过命令行查询和做少数安全操作。

## 怎么调用

在 MediaPilot 项目目录下执行(路径见 ~/.hermes/scripts/mediapilot-brief.sh 里的 cd 那一行):

    MP_AGENT=hermes npm run -s mp -- <命令> --json

输出是一行 JSON: `{"ok":true,"data":...}` 或 `{"ok":false,"error":{"code":"...","message":"..."}}`。

## 你能用的命令

- `mp help` 列出你能用的全部命令
- `mp status` 概况 · `mp brief` 每日简报
- `mp topics hits` 近期对标爆款 · `mp topics show <作品>` 拆解 · `mp topics accounts` 对标账号 · `mp topics suggest` 编导挑 3 个选题
- `mp project list` / `mp project show <项目>` · `mp project new --title <标题> [--from-video <作品>]`
- `mp publish candidates` / `mp publish link <项目> <作品>` · `mp retro show <项目>`
- `mp lessons list` / `mp lessons adopt <经验>` / `mp lessons reject <经验>` · `mp tasks status`

## 规矩

- 回复适合手机看: 短句, 不用表格, 最多 5 条; 先说结论。
- 只转述命令输出, 不编数据、不猜原因。命令没给的信息就说"工具里没有"。
- 返回 `forbidden`(退出码 2)时回复: "这个要回电脑上做。" 不要尝试别的命令绕过。
- 写稿、改稿、出片、搜博主、巡检、拆解都不能在微信里做。
- 采纳 / 不要写法经验、确认作品关联之前, 先把内容复述给用户并等用户明确说"采纳/确认"。
- 多条信息合并成一条消息发送(微信有发送频率限制)。
