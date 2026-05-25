#!/bin/bash
set -e
mkdir -p /profiles
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
