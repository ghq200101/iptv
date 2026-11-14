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

## 命令约定：先分清在哪台机器、用哪个 shell

本文有两类命令，**不要混在同一个窗口里敲**：

| 标记 | 在哪运行 | shell |
|---|---|---|
| 🪟 **本地** | 你的 Windows，工作目录 `E:\docker\iptv` | **PowerShell** |
| 🐧 **VPS** | 服务器，工作目录 `/opt/iptv` | bash |

最容易踩的坑：`tail`、`grep`、`ls`、`cat`、`rm` 是 Linux 命令，PowerShell 里没有，
直接敲会报 `无法将"tail"项识别为 cmdlet、函数、脚本文件或可运行程序的名称`。

本地对应的写法：

| Linux | PowerShell |
|---|---|
| `tail -5` | `Select-Object -Last 5` |
| `head -5` | `Select-Object -First 5` |
| `grep 关键字 文件` | `Select-String -Path 文件 -Pattern 关键字` |
| `grep -c` | `(Select-String ...).Count` |
| `ls` | `Get-ChildItem` |
| `cat 文件` | `Get-Content 文件` |
| `rm 文件` | `Remove-Item 文件` |
| `which git` | `Get-Command git` |

完整对照见文末「附录 A」。

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

改一个不影响功能的文件（比如 `docs/` 里加一行），提交推送。

🪟 **本地 PowerShell**：

```powershell
git log --oneline -1
git push origin main
```

然后去 GitHub 网页 → Actions → 看 "Docker Publish" 是否全绿。

🐧 **VPS（bash）** —— 立刻触发一次，不等 3 点：

```bash
sudo systemctl start iptv-update.service
journalctl -u iptv-update.service -n 30 --no-pager
```

看到 `更新完成: <提交号>` 就说明通了。

---

## 2. 日常：改代码并上线

### 2.1 标准流程

🪟 **本地 PowerShell**（`git` 命令本身两个 shell 通用，主要是别混入 `tail`/`grep`）：

```powershell
cd E:\docker\iptv

# 1) 先同步，避免基于旧代码开工
git fetch origin
git status

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

🪟 **本地 PowerShell**。不用每次推了才看结果，最轻的做法：

```powershell
cd E:\docker\iptv
npm ci                 # 首次
node app.js            # 直接跑源码，默认监听 2086
```

浏览器开 `http://127.0.0.1:2086/admin`，确认页面和频道正常。改完 `Ctrl+C` 停掉。

想连 Docker 一起验：

```powershell
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

🐧 **VPS（bash）**，不想等 3 点：

```bash
sudo systemctl start iptv-update.service
journalctl -u iptv-update.service -n 20 --no-pager
```

---

## 3. 同步上游

Fork 的成本就在这里：上游一直在发版，你得手动合。

🪟 **本地 PowerShell**：

```powershell
cd E:\docker\iptv

git fetch upstream --tags                       # 拉取上游标签

# 看最新 5 个版本（PowerShell 没有 tail）
git tag -l 'v4.*' | Sort-Object { [version]($_ -replace '^v','') } | Select-Object -Last 5

git merge v4.72.0                              # 换成要合的目标版本
```

> 如果你在 Git Bash 里操作，可以照旧用 `git tag -l 'v4.*' | tail -5`。
> 混着用在同一个窗口里就会报「无法将 tail 项识别为 cmdlet」——这正是本文要避免的。

### 3.1 冲突只有两个文件

| 文件 | 处理 | 原因 |
|---|---|---|
| `.github/workflows/push_docker.yaml` | 保留自己的（`--ours`） | 上游推 `akiralereal/iptv`，你推 `ghq200101/iptv` |
| `package.json` | 取上游（`--theirs`），再把 version 改成 `v4.xx.1` | 两边都改过 `version` 字段 |

🪟 **本地 PowerShell**：

```powershell
# 1) workflow 保留自己的
git checkout --ours -- .github/workflows/push_docker.yaml
git add .github/workflows/push_docker.yaml

# 2) package.json 取上游，再把版本号改成 v4.xx.1（含自己的补丁，版本号和上游区分开）
git checkout --theirs -- package.json
$p = 'package.json'
$t = [IO.File]::ReadAllText($p)
$t = [regex]::Replace($t, '"version":\s*"[^"]+"', '"version": "4.72.1"', 1)
[IO.File]::WriteAllText($p, $t)
git add package.json

git commit -m "Merge upstream v4.72.0"
```

> 改文件那两行别用 `Set-Content`/`Out-File`——Windows PowerShell 5.1 会写成带 BOM 的 UTF-8，
> 严重的会把中文注释变成乱码（真出过事故，导致 CI 直接失败）。`[IO.File]::WriteAllText`
> 写的是无 BOM 的 UTF-8，两个版本都安全。

其余文件（`docker-compose.yml`、`deploy/`、`docs/`、`.dockerignore`）不会冲突：上游没有这些
文件，或改动不重叠，git 会自动保留你的版本。

### 3.2 合并后必查三件事

🪟 **本地 PowerShell**：

```powershell
# 1) 版本号（应该是 v4.xx.1，比上游多一个补丁号）
(Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version

# 2) compose 的端口必须还是本机绑定
Select-String -Path docker-compose.yml -Pattern '127.0.0.1|mhost'

# 3) 自己的部署文件还在（应该是 7 个）
(Get-ChildItem deploy).Count
```

想一次看全，可以跑：

```powershell
@(
  "version = " + (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
  "compose  = " + ((Select-String -Path docker-compose.yml -Pattern '127\.0\.0\.1:2086').Line -replace '^\s+','')
  "deploy   = " + (Get-ChildItem deploy).Count + ' 个文件'
  "yangshipin 修复 = " + (Select-String -Path extractors\yangshipin\browser-auth.js -Pattern 'Boolean\(window\.yspLogin').Count
) -join "`n"
```

### 3.3 发布

🪟 **本地 PowerShell**：

```powershell
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

---

## 附录 A：PowerShell ↔ bash 对照

本地是 Windows，默认 shell 是 **PowerShell**；VPS 上是 **bash**。同样的意图，两边写法不同。

| 用途 | bash（VPS） | PowerShell（本地） |
|---|---|---|
| 看最后 5 行 | `tail -5` | `Select-Object -Last 5` |
| 看前 5 行 | `head -5` | `Select-Object -First 5` |
| 搜文件内容 | `grep 关键词 文件` | `Select-String -Path 文件 -Pattern 关键词` |
| 递归搜目录 | `grep -rn 关键词 .` | `Get-ChildItem -Recurse -File \| Select-String -Pattern 关键词` |
| 统计匹配行数 | `grep -c 关键词 文件` | `(Select-String -Path 文件 -Pattern 关键词).Count` |
| 列目录 | `ls -l` | `Get-ChildItem` |
| 看文件 | `cat 文件` | `Get-Content 文件 -Encoding UTF8` |
| 删文件 | `rm 文件` | `Remove-Item 文件` |
| 命令在哪 | `which git` | `Get-Command git` |
| 环境变量 | `echo $PATH` | `$env:PATH` |
| 提取 JSON 字段 | `jq -r .version` | `(Get-Content x -Raw -Encoding UTF8 \| ConvertFrom-Json).version` |
| 原地改文件 | `sed -i` | `[IO.File]::WriteAllText(...)`（见 3.1） |

### A.1 四个必须注意的坑

1. **`tail` / `grep` / `ls` / `cat` / `rm` 在 PowerShell 里不存在**，会报
   `CommandNotFoundException`。截图里那个红字就是这么来的。
2. **别用 `Set-Content` / `Out-File` 改仓库文件**。Windows PowerShell 5.1 会写成带 BOM 或
   按 ANSI 编码，中文注释会变成乱码（真出过事故，CI 直接失败）。
   统一用 `[IO.File]::ReadAllText` + `[IO.File]::WriteAllText`。
3. **`&&` 在 PowerShell 5.1 不支持**（7.0+ 才支持）。用 `;` 分隔，或分成两行。
4. **双引号里的 `$` 会被展开**。git commit 信息里如果有 `$`，用单引号包起来。

### A.2 一次完整的上游同步（可直接照抄）

🪟 **本地 PowerShell**（把 `4.72.0` 换成目标版本）：

```powershell
cd E:\docker\iptv

git fetch upstream --tags
git tag -l 'v4.*' | Sort-Object { [version]($_ -replace '^v','') } | Select-Object -Last 5

git merge v4.72.0

# 冲突 1：workflow 保留自己的
git checkout --ours -- .github/workflows/push_docker.yaml
git add .github/workflows/push_docker.yaml

# 冲突 2：package.json 取上游，再把版本号 +1
git checkout --theirs -- package.json
$p = 'package.json'
$t = [IO.File]::ReadAllText($p)
$t = [regex]::Replace($t, '"version":\s*"[^"]+"', '"version": "4.72.1"', 1)
[IO.File]::WriteAllText($p, $t)
git add package.json

git commit -m 'Merge upstream v4.72.0'
git push origin main
```

🐧 **VPS（bash）**：

```bash
cd /opt/iptv
git fetch origin && git reset --hard origin/main
systemctl start iptv-update.service
journalctl -u iptv-update.service -n 20 --no-pager
```

