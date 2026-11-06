#!/usr/bin/env bash
#
# update-iptv.sh —— VPS 端 IPTV 自动更新脚本
#
# 由 iptv-update.timer 每天触发，也可以手动跑：
#   sudo /usr/local/bin/update-iptv.sh           # 正常更新
#   sudo /usr/local/bin/update-iptv.sh --force   # 镜像没变也强制重建
#   sudo /usr/local/bin/update-iptv.sh --check   # 只看有没有新镜像，不动容器
#
# 设计要点：
#   1. flock 互斥，手动执行和定时器撞车时不会互相踩；
#   2. git reset --hard 到 origin/main，保证服务器上的 compose 和仓库一致（不产生漂移）；
#   3. 先比镜像 ID，没变就不重启容器（少一次无谓的重启和数据刷新）；
#   4. 新镜像起不来时自动回滚到上一个镜像，并把错误写进 journal；
#   5. 清理 7 天前的旧镜像，避免磁盘被多架构镜像撑满。
#
set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-/opt/iptv}"
GIT_BRANCH="${GIT_BRANCH:-main}"
IMAGE="${IMAGE:-ghq200101/iptv:latest}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:2086/}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"   # 秒
LOCK_FILE="${LOCK_FILE:-/var/lock/iptv-update.lock}"
ENV_FILE="${ENV_FILE:-/etc/default/iptv-update}"

FORCE=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '%s [update-iptv] %s\n' "$(date '+%F %T')" "$*" >&2; }
die()  { log "ERROR: $*"; notify "IPTV 更新失败：$*"; exit 1; }

# 可选的通知配置，写在 /etc/default/iptv-update 里，例如：
#   NOTIFY_URL="https://api.day.app/你的key"
#   通知走 Bark / Server酱 这类“POST text=...”的接口即可，留空则不发。
NOTIFY_URL=""
# shellcheck disable=SC1090
if [ -f "$ENV_FILE" ]; then . "$ENV_FILE"; fi

notify() {
  [ -n "${NOTIFY_URL:-}" ] || return 0
  curl -fsS -m 10 --data-urlencode "text=$1" "$NOTIFY_URL" >/dev/null 2>&1 \
    || log "通知发送失败（忽略）"
}

# ---- 0. 互斥锁 -------------------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || { log "已有另一个更新进程在跑，本次跳过"; exit 0; }

cd "$REPO_DIR" || die "仓库目录不存在: $REPO_DIR"
git rev-parse --git-dir >/dev/null 2>&1 || die "$REPO_DIR 不是 git 仓库"

# ---- 1. 同步仓库（force 不改代码，只保证 compose/脚本是最新的）-------------
log "拉取 origin/$GIT_BRANCH"
git fetch --prune --quiet origin "$GIT_BRANCH"

LOCAL_REV=$(git rev-parse HEAD)
REMOTE_REV=$(git rev-parse "origin/$GIT_BRANCH")
if [ "$LOCAL_REV" != "$REMOTE_REV" ]; then
  # data/ 已在 .gitignore 里，不会被这里动到
  git reset --hard --quiet "origin/$GIT_BRANCH"
  log "代码已更新: $(git log -1 --pretty='%h %s')"
else
  log "代码无变化: ${LOCAL_REV:0:7}"
fi

# ---- 2. 选择 compose 命令 ---------------------------------------------------
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(docker-compose)
fi
[ -f docker-compose.yml ] || die "缺少 docker-compose.yml"

# ---- 3. 拉镜像并比对 -------------------------------------------------------
OLD_ID=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)
log "拉取镜像 $IMAGE"
"${DC[@]}" pull --quiet || die "docker compose pull 失败"
NEW_ID=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)
[ -n "$NEW_ID" ] || die "拉取后仍找不到镜像 $IMAGE"

if [ "$OLD_ID" = "$NEW_ID" ] && [ "$FORCE" -eq 0 ]; then
  log "镜像未变化（${NEW_ID:7:12}），不重启容器"
  [ "$CHECK_ONLY" -eq 1 ] && log "check: up-to-date"
  exit 0
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  log "check: 有新镜像 ${OLD_ID:7:12} -> ${NEW_ID:7:12}（未应用）"
  exit 0
fi

log "镜像变化: ${OLD_ID:7:12} -> ${NEW_ID:7:12}，重建容器"

# ---- 4. 重建并等待健康 -----------------------------------------------------
"${DC[@]}" up -d --remove-orphans || die "docker compose up 失败"

healthy=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "$HEALTH_URL" 2>/dev/null || true)
  case "$code" in
    2*|3*|401|403) healthy=1; break ;;   # 401/403 说明服务在，只是要密码
  esac
  sleep 1
done

if [ "$healthy" -ne 1 ]; then
  log "新镜像 ${HEALTH_TIMEOUT}s 内未响应，开始回滚"
  if [ -n "$OLD_ID" ]; then
    docker tag "$OLD_ID" "$IMAGE"
    "${DC[@]}" up -d --force-recreate || true
    notify "IPTV 新镜像不健康，已回滚到 ${OLD_ID:7:12}"
  else
    notify "IPTV 新镜像不健康，且没有可回滚的旧镜像"
  fi
  die "健康检查失败（$HEALTH_URL）"
fi

# ---- 5. 收尾 ---------------------------------------------------------------
docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
VERSION=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$IMAGE" 2>/dev/null || true)
log "更新完成: $(git log -1 --pretty='%h %s')"
notify "IPTV 已更新到 ${VERSION:-$NEW_ID}"
