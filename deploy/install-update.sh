#!/usr/bin/env bash
#
# install-update.sh —— 一次性安装/升级 VPS 端的自动更新组件
#
#   sudo bash deploy/install-update.sh
#
# 做四件事：
#   1. update-iptv.sh 装到 /usr/local/bin（这样 git reset 不会覆盖它，也不会在仓库里留下脏文件）
#   2. systemd unit 装到 /etc/systemd/system
#   3. 生成 /etc/default/iptv-update（通知配置，留空即不发通知）
#   4. 启用并立即启动 timer，打印下次触发时间
#
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行：sudo bash deploy/install-update.sh" >&2; exit 1; }

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/opt/iptv}"

install -m 0755 "$SRC_DIR/update-iptv.sh"      /usr/local/bin/update-iptv.sh
install -m 0644 "$SRC_DIR/iptv-update.service" /etc/systemd/system/iptv-update.service
install -m 0644 "$SRC_DIR/iptv-update.timer"   /etc/systemd/system/iptv-update.timer

if [ ! -f /etc/default/iptv-update ]; then
  cat > /etc/default/iptv-update <<'EOF'
# IPTV 自动更新配置（update-iptv.sh 会读取本文件）
#
# 可选：更新成功/失败时发通知，支持任何接受 POST text=... 的服务，例如 Bark：
#   NOTIFY_URL="https://api.day.app/你的key"
# 留空则不发送。
NOTIFY_URL=""

# 可选：覆盖默认值
# REPO_DIR="/opt/iptv"
# IMAGE="ghq200101/iptv:latest"
# HEALTH_URL="http://127.0.0.1:2086/"
# HEALTH_TIMEOUT=90
EOF
  chmod 0644 /etc/default/iptv-update
  echo "已生成 /etc/default/iptv-update"
fi

systemctl daemon-reload
systemctl enable iptv-update.timer >/dev/null
systemctl restart iptv-update.timer

echo
echo "安装完成。当前状态："
systemctl is-enabled iptv-update.timer || true
systemctl list-timers iptv-update.timer --no-pager || true
echo
echo "手动试跑： sudo /usr/local/bin/update-iptv.sh --check"
echo "查看日志： journalctl -u iptv-update.service -n 50 --no-pager"
echo "仓库目录： ${REPO_DIR}（脚本默认从 $REPO_DIR 同步代码，如需修改请改 /etc/default/iptv-update 里的 REPO_DIR）"
