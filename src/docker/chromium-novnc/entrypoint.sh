#!/bin/bash
set -e
mkdir -p /profiles/default
# 清掉上次容器残留的 lock,否则 Chromium 启动报 process_singleton_posix.cc 然后退出
rm -f /profiles/default/Singleton*
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
