# IPTV 自托管全流程手册

从「上游发版」到「你手机上能看」，中间要经过四个环节。这份文档把每个环节的职责、
命令和坑都写全，照着做就行。

```
   ┌──────────────────────┐
   │ 上游 akiralereal/iptv │  别人维护的项目
   └──────────┬───────────┘
              │ fork / merge
   ┌──────────▼───────────┐
   │ 本地 E:\docker\iptv   │  你改代码、合并上游、提交
   └──────────┬───────────┘
              │ git push origin main
   ┌──────────▼───────────┐
   │ ghq200101/iptv (GitHub)│  代码托管 + Actions 自动构建
   └──────────┬───────────┘
              │ 推送多架构镜像
   ┌──────────▼───────────┐
   │ ghq200101/iptv (Docker Hub) │  镜像仓库
   └──────────┬───────────┘
              │ 每天 03:00（VPS 定时器）
   ┌──────────▼───────────┐
   │ VPS /opt/iptv         │  拉镜像、重建容器
   └──────────┬───────────┘
              │ Cloudflare
   ┌──────────▼───────────┐
   │ 手机 / 电视盒 / 电脑   │  https://iptv.czghq.com
   └──────────────────────┘
```

---

## 0. 三条原则

这三条想清楚，后面就不会乱。

1. **仓库是唯一源头。** VPS 上的代码由 `git reset --hard origin/main` 强制对齐仓库。
   在服务器上手工改任何文件，下一次自动更新就会被覆盖——要改就改仓库、走 CI。
2. **镜像只由 CI 产出。** 不在 VPS 上 `docker build`，也不在本地往 Docker Hub 推。
   本地构建只能用于调试，别让「本地构建的镜像」和「线上跑的镜像」混在一起。
3. **用 `sha-` 标签定位版本。** `latest` 会动，`sha-xxxxxxx` 永远指向某一次提交。
   线上出问题要看「到底是哪个提交」，就看这个标签。

---

## 1. 一次性搭建

### 1.1 Fork 与本地仓库

```bash
# 在 GitHub 网页点 Fork，得到 https://github.com/ghq200101/iptv
git clone git@github.com:ghq200101/iptv.git E:/docker/iptv
cd E:/docker/iptv

# 加一个上游远端，方便以后同步
git remote add upstream https://github.com/akiralereal/iptv.git
git remote -v      # 应该看到 origin 和 upstream
```

### 1.2 Docker Hub

1. 登录 Docker Hub，确认有 `ghq200101/iptv` 这个仓库（没有就 Create repository，Public）。
2. 头像 → **Account settings → Personal access tokens → Generate new token**，
   Scope 选 **Read & Write**，生成后立刻复制（只显示一次）。
3. 这个 token 就是 CI 推镜像用的密码，**不要用账号登录密码**。

### 1.3 GitHub 仓库配置

`Settings → Secrets and variables → Actions → New repository secret`：

| Name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `ghq200101` |
| `DOCKERHUB_PASSWORD` | 上一步生成的 Access Token |

可选但推荐：`Settings → Branches → Add branch protection rule`，对 `main` 要求
「Require status checks to pass」，勾上 `verify (lint + smoke test)`，这样坏代码进不了 main。

### 1.4 VPS 初始化

前提：已装 Git、Docker Engine、Docker Compose 插件。

```bash
sudo git clone https://github.com/ghq200101/iptv.git /opt/iptv
cd /opt/iptv
sudo docker compose up -d

# 装自动更新（脚本 + systemd unit + 定时器，一条命令）
sudo bash deploy/install-update.sh

# 先只看不动，确认脚本能正常工作
sudo /usr/local/bin/update-iptv.sh --check
```

`install-update.sh` 会做四件事：

- 把 `update-iptv.sh` 装到 `/usr/local/bin`（**不放在仓库里**，这样 `git reset` 不会把它冲掉）
- 把 `iptv-update.service`、`iptv-update.timer` 装到 `/etc/systemd/system`
- 生成 `/etc/default/iptv-update`（通知配置，留空即不发）
- 启用并启动定时器

### 1.5 验证整条链路

改一个不影响功能的文件（比如 `docs/` 里加一行），提交推送，然后：

```bash
# 本地看
git log --oneline -1
git push origin main

# GitHub 网页 → Actions → 看 "Docker Publish" 是否全绿

# VPS 上立刻触发一次（不等 3 点）
sudo systemctl start iptv-update.service
journalctl -u iptv-update.service -n 30 --no-pager
```

看到 `更新完成: <提交号>` 就说明通了。

---

## 2. 日常：改代码并上线

### 2.1 标准流程

```bash
cd E:/docker/iptv

# 1) 先同步，避免基于旧代码开工
git fetch origin && git status

# 2) 改代码
#    ...

# 3) 本地粗验（可选，见 2.3）
# 4) 提交
git add -A
git commit -m "feat: 某个频道的解析修复"

# 5) 推送 —— 这一步就是「发布」
git push origin main
```

推送之后发生的事情，你不需要插手：

```
push main
  → Actions 触发（改动命中 paths 才会触发）
  → verify：hadolint + 冒烟测试
  → build：amd64 / arm64 / armv7 / armv6 四平台并行，带缓存
  → merge：打标签 latest / 4.x.y / 4.x / 4 / sha-xxxxxxx
  → Docker Hub 上出现新镜像
  → VPS 次日 03:00 自动更新（或你手动 systemctl start）
```

### 2.2 什么改动会触发构建

`.github/workflows/push_docker.yaml` 里的 `paths` 白名单：

```
Dockerfile  package.json  package-lock.json  app.js  config.js
utils/**  extractors/**  web/**  scripts/**  .dockerignore  .github/workflows/**
```

所以：

- 改 `deploy/`、`docs/`、`README.md` → **不会**重新构建镜像（它们也不进镜像）
- 改 `app.js`、`utils/`、`extractors/` → 会构建

这是故意的：运维脚本和文档的改动不该导致线上重启。

### 2.3 本地快速验证

不用每次推了才看结果。最轻的做法：

```bash
cd E:/docker/iptv
npm ci                 # 首次
node app.js            # 直接跑源码，默认监听 2086
```

浏览器开 `http://127.0.0.1:2086/admin`，确认页面和频道正常。改完 `Ctrl+C` 停掉。

想连 Docker 一起验：

```bash
docker compose build   # 只构建，不推
docker compose up -d
```

### 2.4 版本号什么时候改

`package.json` 的 `version` 决定镜像的版本标签：

| 改动 | 建议 |
|---|---|
| 修 bug、改解析 | patch：4.61.0 → 4.61.1 |
| 加功能 | minor：4.61.1 → 4.62.0 |
| 破坏性变更（改数据目录、改配置项名） | major |

不改版本号也能发，只是 Docker Hub 上会被新镜像覆盖同一个版本标签，回滚时不好定位。

### 2.5 立即让 VPS 更新

不想等 3 点：

```bash
sudo systemctl start iptv-update.service
journalctl -u iptv-update.service -n 20 --no-pager
```

---

## 3. 同步上游

Fork 的成本就在这里：上游一直在发版，你得手动合。

```bash
cd E:/docker/iptv

git fetch upstream --tags          # 拉取上游标签
git tag -l 'v4.*' | tail -5        # 看最新有哪些版本

git merge v4.61.0                  # 合并目标版本
```

### 3.1 冲突只可能出现在一个地方

正常情况只有 `.github/workflows/push_docker.yaml` 会冲突——因为上游的工作流推的是
`akiralereal/iptv`，而你的是 `ghq200101/iptv`。**一律保留自己的**：

```bash
git checkout --ours -- .github/workflows/push_docker.yaml
git add .github/workflows/push_docker.yaml
git commit -m "Merge upstream v4.61.0"
```

`docker-compose.yml`、`deploy/`、`docs/`、`.dockerignore` 之所以不冲突，是因为上游
没有这些文件（或改动不重叠），git 会自动保留你的版本。

### 3.2 合并后必查三件事

```bash
# 1) 版本号是否跟上了上游
grep '"version"' package.json

# 2) compose 的端口还得是本机绑定
grep -n '127.0.0.1\|mhost' docker-compose.yml

# 3) 自己的部署文件还在
ls deploy/
```

### 3.3 发布

```bash
git push origin main
```

然后等 CI 跑完，VPS 次日自动更新。上游发版说明里如果有「海外部署请关闭某模块」之类的
提示，记得去 `https://iptv.czghq.com/admin` 关掉对应模块。

---

## 4. 自动更新是怎么工作的

### 4.1 脚本的六步

`/usr/local/bin/update-iptv.sh`（源码在仓库 `deploy/update-iptv.sh`）：

1. **加锁**：`flock`，手动执行和定时器撞车时后者直接退出
2. **同步代码**：`git fetch` + `git reset --hard origin/main`
3. **拉镜像**：`docker compose pull`
4. **比对**：拿**容器实际在跑的镜像 ID** 和拉下来的新镜像比，一样就退出（不重启）
5. **重建 + 健康检查**：`up -d`，然后轮询 `http://127.0.0.1:2086/`，90 秒不通就回滚
6. **收尾**：清理 7 天前的旧镜像，可选发通知

> 第 4 步是踩过坑的：早先版本拿「tag 前后状态」比，`pull` 已经把 tag 移到新镜像了，
> 于是永远判成「没变化」，日志写「更新完成」，容器却还是旧的。现在改为跟容器比。

### 4.2 定时器

```ini
OnCalendar=*-*-* 03:00:00 Asia/Shanghai   # 显式时区，服务器是 UTC 也不会跑偏
Persistent=true                            # 关机错过的，开机后补跑
RandomizedDelaySec=15m                     # 错峰
```

查看下次触发：`systemctl list-timers iptv-update.timer`

### 4.3 通知（可选）

编辑 `/etc/default/iptv-update`：

```bash
NOTIFY_URL="https://api.day.app/你的key"   # Bark；任何接受 POST text=... 的服务都行
```

更新成功和失败都会推一条。

---

## 5. 运维手册

| 我要…… | 命令 |
|---|---|
| 看服务状态 | `docker ps`；`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:2086/` |
| 看应用日志 | `docker logs -f --tail 100 iptv` |
| 看更新日志 | `journalctl -u iptv-update.service -n 50 --no-pager` |
| 看下次更新 | `systemctl list-timers iptv-update.timer` |
| 立即更新 | `systemctl start iptv-update.service` |
| 只检查不更新 | `/usr/local/bin/update-iptv.sh --check` |
| 强制重建（镜像没变也重来） | `/usr/local/bin/update-iptv.sh --force` |
| 暂停自动更新 | `systemctl disable --now iptv-update.timer` |
| 恢复自动更新 | `systemctl enable --now iptv-update.timer` |
| 看磁盘 | `df -h /` |
| 看镜像占用 | `docker images ghq200101/iptv` |
| 清旧镜像 | `docker image prune -f --until=72h` |

### 5.1 备份数据

所有配置、订阅、频道、token 都在 `/opt/iptv/data`：

```bash
sudo tar czf /root/iptv-data-$(date +%F).tgz -C /opt/iptv data
```

后台「设置 → 备份迁移」也能导出 JSON，适合搬家时导入另一套实例。

### 5.2 访问后台

| 场景 | 地址 |
|---|---|
| 正常管理 | `https://iptv.czghq.com/admin` |
| 绕过 Cloudflare、直连源站 | `ssh -L 2086:127.0.0.1:2086 my-vps`，然后 `http://127.0.0.1:2086/admin` |

容器端口只在 VPS 回环上监听（`127.0.0.1:2086`），外网只能经 nginx/Cloudflare 进来。

---

## 6. 排错

| 现象 | 大概率原因 | 处理 |
|---|---|---|
| Actions 秒失败，没有 job | YAML 语法/编码坏了 | 打开 workflow 检查，别用 `Set-Content` 这类会改编码的方式编辑 |
| `verify` 挂了 | hadolint 报错或冒烟测试失败 | 看 job 日志，优先修 Dockerfile 的 error 级问题 |
| 镜像没更新，但 CI 显示成功 | 改动没命中 `paths` | 确认改的是 `app.js`/`utils/` 等白名单里的路径 |
| VPS 说「已是最新」但容器是旧的 | 老版本脚本的比对 bug | 已修复；确认 `/usr/local/bin/update-iptv.sh` 是最新版（重跑 install） |
| 容器起不来 | 新镜像有问题 | 脚本会自动回滚；看 `journalctl -u iptv-update` 确认回滚成功 |
| 后台打不开 | Cloudflare 或 nginx | 先 `curl -I http://127.0.0.1:2086/` 确认容器活着，再查 nginx/CF |
| 某频道播不了 | 源站或地区限制 | 看 `docker logs iptv` 里对应模块的报错；海外 VPS 要关掉辽宁、大连这类只对大陆放行的模块 |
| 老安卓盒子报 handshake failure | Cloudflare 只给 ECDSA 套件 | 用 `http://` 地址；且「始终使用 HTTPS」必须保持关闭，详见 `docs/DEPLOY.md` |
| 磁盘快满 | 多架构镜像 + 旧版本堆积 | `docker image prune -f --until=72h`，或把脚本里的 168h 改小 |

### 6.1 回滚到上一个版本

```bash
cd /opt/iptv
sed -i 's#ghq200101/iptv:latest#ghq200101/iptv:sha-6585f0d#' docker-compose.yml
docker compose up -d
```

注意：手动改 compose 会在下次自动更新时被 `reset --hard` 覆盖，所以**长期回滚要改仓库**。

---

## 7. 参数速查

| 项目 | 值 |
|---|---|
| 上游仓库 | `akiralereal/iptv` |
| 你的仓库 | `ghq200101/iptv` |
| 镜像 | `ghq200101/iptv`（amd64 / arm64 / armv7 / armv6） |
| VPS 目录 | `/opt/iptv` |
| 容器端口 | `127.0.0.1:2086` |
| 更新脚本 | `/usr/local/bin/update-iptv.sh` |
| 更新配置 | `/etc/default/iptv-update` |
| 服务 / 定时器 | `iptv-update.service` / `iptv-update.timer` |
| 更新锁 | `/var/lock/iptv-update.lock` |
| 域名 | `https://iptv.czghq.com` |
| 老设备入口 | `http://iptv.czghq.com/interface.m3u` |
