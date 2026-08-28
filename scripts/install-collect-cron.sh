#!/bin/zsh
# 安装/卸载每晚 20:00 的抖音数据回采定时任务(macOS launchd)。
#
#   sh scripts/install-collect-cron.sh            # 安装
#   sh scripts/install-collect-cron.sh uninstall  # 卸载
#
# 为什么用 launchd 而不是应用内的队列: 队列要 worker 在跑, 而 worker 需要手动启动 ——
# 这个项目已经因为它静默不跑吃过大亏。launchd 由系统拉起, 不依赖任何进程。

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.mediapilot.collect-douyin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$1" = "uninstall" ]; then
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 $LABEL"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/logs"
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/scripts/$LABEL.plist" > "$PLIST"

# 先卸再装, 保证改过 plist 之后生效
launchctl unload -w "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "已安装 $LABEL —— 每晚 20:00 回采"
echo "  日志: $PROJECT_DIR/logs/collect-douyin.log"
echo "  立刻跑一次验证: npm run collect:douyin"
echo "  查看状态: launchctl list | grep collect-douyin"
