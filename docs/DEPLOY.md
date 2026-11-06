# IPTV 镜像发布与 VPS 自动更新

```
本地 E:\docker\iptv
   │  git push origin main
   ▼
GitHub  ghq200101/iptv (main)
   │  Actions: verify → build(4 平台, 按 digest 推) → merge(打标签)
   ▼
Docker Hub  ghq200101/iptv:latest / :4.39.0 / :4.39 / :4 / :sha-xxxxxxx
   │  VPS 每天 03:00（iptv-update.timer）
   ▼
VPS /opt/iptv
   ├─ git fetch + reset --hard origin/main   （compose 与仓库保持一致）
   ├─ docker compose pull                     （只拉 manifest 对应的层）
   ├─ 镜像 ID 没变 → 直接退出，不重启
   └─ 变了 → up -d → 等待健康 → 失败自动回滚
```

## 一次性配置

### 1. GitHub 仓库 secrets

`Settings → Secrets and variables → Actions`：

| 名称 | 说明 |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名（`ghq200101`） |
| `DOCKERHUB_PASSWORD` | Docker Hub **Access Token**，不要用登录密码 |

建议同时开启分支保护：`main` 只允许通过 PR 合并，并要求 `verify` 通过。

### 2. VPS

```bash
# 已经 clone 过的话跳过；没有的话：
git clone https://github.com/ghq200101/iptv.git /opt/iptv

cd /opt/iptv
sudo docker compose pull
sudo docker compose up -d

# 安装自动更新组件（脚本、service、timer 一次装好）
sudo bash deploy/install-update.sh

# 试跑一次，只看不动：
sudo /usr/local/bin/update-iptv.sh --check
```

### 3. 通知（可选）

编辑 `/etc/default/iptv-update`：

```bash
NOTIFY_URL="https://api.day.app/你的key"
```

更新成功/失败都会 POST `text=...` 过去。

## 日常操作

| 场景 | 命令 |
|---|---|
| 看下次什么时候跑 | `systemctl list-timers iptv-update.timer` |
| 立即更新 | `sudo systemctl start iptv-update.service` |
| 只看有没有新镜像 | `sudo /usr/local/bin/update-iptv.sh --check` |
| 强制重建（镜像没变也重来） | `sudo /usr/local/bin/update-iptv.sh --force` |
| 看日志 | `journalctl -u iptv-update.service -n 100 --no-pager` |
| 临时停掉自动更新 | `sudo systemctl disable --now iptv-update.timer` |

## 回滚

自动更新失败会自动回滚到上一个镜像。要手动退回某个版本：

```bash
cd /opt/iptv
# 方式一：改用具体版本标签（改 compose 后 up -d）
sed -i 's#ghq200101/iptv:latest#ghq200101/iptv:4.38.0#' docker-compose.yml
docker compose up -d

# 方式二：直接跑某次提交构建的镜像
sed -i 's#ghq200101/iptv:latest#ghq200101/iptv:sha-1a2b3c4#' docker-compose.yml
docker compose up -d
```

注意：手动改过 compose 后，下一次自动更新会 `git reset --hard` 覆盖掉，所以长期回退请改仓库里的 `docker-compose.yml` 并提交。

## 和上游同步

Fork 的代价是要手动跟上游。推荐流程：

```bash
git remote add upstream https://github.com/akiralereal/iptv.git   # 只需一次
git fetch upstream
git merge --no-ff upstream/main          # 有冲突就解，别用 rebase 改写历史
git push origin main
```

上游更新频繁时，一个月合一次就够。`git reset --hard` 只在 VPS 用，本地永远不要用。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 推送后 Docker Hub 还是旧镜像 | 两次构建并发，旧任务后完成覆盖了 latest | 已加 `concurrency: cancel-in-progress`，新版不会再出现 |
| Actions 在 arm/v6 上超时 | QEMU 模拟下装 chromium 很慢 | 已把 timeout 提到 30 分钟；不用 arm/v6 就从矩阵里删掉 |
| VPS 上 `git pull` 冲突 | 服务器上手动改过 compose | 已改成 `reset --hard`；改配置请改仓库再提交 |
| 更新后打不开 | 新镜像启动失败 | 脚本健康检查失败会自动回滚；看 `journalctl -u iptv-update` |
| 磁盘被镜像撑满 | 多架构镜像每个都几百 MB | 脚本每次成功后清理 7 天前的悬空镜像 |
| 定时器没跑 | 服务器时区是 UTC，03:00 实际是北京时间 11:00 | timer 里已显式写 `Asia/Shanghai` |
| 关机错过了更新 | 默认不会补跑 | 已加 `Persistent=true` |

## 老设备兼容：为什么 80 端口是明文

2026-11 实际踩到的坑，记下来免得以后又推翻。

**现象**：Android 4.2.2 的电视盒用 `https://iptv.czghq.com/interface.m3u` 报
`SSL handshake aborted … error:14077410 … sslv3 alert handshake failure`。

**真因**：这个 Cloudflare zone 的边缘**只提供 ECDSA 证书和 ECDSA 套件**（实测
`TLS_ECDHE_ECDSA_AES128_CBC_SHA` 可谈，而 `AES128-SHA`、`ECDHE-RSA-AES128-GCM-SHA256`
在 TLS1.0/1.2 下都直接回 alert 40）。Android 4.2 的 TLS 栈只有 RSA 套件，没有交集就
必然握手失败。**不是 TLS 版本问题**，把 Minimum TLS Version 调到 1.0 没用；也不是
IP 被封（改成跟容器实际镜像比较那次已经验证过，国内直连 Cloudflare 是通的）。

**解法**：`80` 端口提供纯 HTTP 入口，反代到容器并把 m3u 里的 `https://` 全量改写成
`http://`。老设备全程不碰 TLS，SNI / ECDSA / 证书信任三关一起绕过。

**依赖**（任何一条被破坏，老设备立刻回退到不可用）：

1. Cloudflare `SSL/TLS → 边缘证书 → 始终使用 HTTPS` **必须保持关闭**；
2. `/usr/local/nginx/conf/vhost/iptv.czghq.com.conf` 的 80 段必须保持反代，
   不要换回 `return 301 https://…`（仓库里的 `deploy/iptv.czghq.com.nginx.conf` 是它的副本）；
3. 源站 `docker-compose.yml` 端口必须是 `127.0.0.1:2086`，对外只经 nginx。

`/admin` 单独 301 回 https，后台不会被明文访问。

