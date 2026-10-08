#!/bin/zsh
# 安装/卸载「登录后自动启动网页服务」(macOS launchd)。
#
#   sh scripts/install-dev-autostart.sh            # 安装(会立刻启动一次; 3000 端口要先空出来)
#   sh scripts/install-dev-autostart.sh uninstall  # 卸载(同时停掉它启动的服务)

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.mediapilot.dev"
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

echo "已安装 $LABEL —— 登录后自动启动网页服务 http://localhost:3000"
echo "  日志: $PROJECT_DIR/logs/dev.log"
echo "  查看状态: launchctl list | grep mediapilot.dev"
