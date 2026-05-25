#!/bin/bash
set -e
# cloakserve stores per-seed user-data in /tmp/cloakserve (default in container).
# Clear any stale SingletonLock files from previous runs.
find /tmp/cloakserve -name 'Singleton*' -delete 2>/dev/null || true
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
