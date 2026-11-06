#!/bin/zsh
# 安装/卸载每天 19:00 的信息源抓取定时任务(macOS launchd)。
#
#   sh scripts/install-fetch-sources-cron.sh            # 安装
#   sh scripts/install-fetch-sources-cron.sh uninstall  # 卸载
#
# 为什么用 launchd: 同 scan-benchmarks —— 队列依赖手动启动的 worker, 已经吃过静默不跑的亏。

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.mediapilot.fetch-sources"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$1" = "uninstall" ]; then
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 $LABEL"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/logs"
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/scripts/$LABEL.plist" > "$PLIST"

launchctl unload -w "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "已安装 $LABEL —— 每天 19:00 抓信息源(GitHub + HN)"
echo "  日志: $PROJECT_DIR/logs/fetch-sources.log"
