#!/bin/sh
set -eu

if [ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/iptv.czghq.com" ]; then
    systemctl reload nginx
fi
