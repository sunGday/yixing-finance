# 阿里云部署 · yunrong.ink

目标机：**47.105.94.93** · 域名：**yunrong.ink**

**Pages = fixtures**（GitHub Pages 演示，不连这台机器）。**Live = Docker Compose** on **yunrong.ink**（本目录）。

浏览器只请求同源 `/api/v1`。`Authorization: Bearer` 由 Next BFF（`web/app/api/v1/[...path]/route.ts`）用服务器上的 `FIN_API_TOKEN` 注入。禁止 `NEXT_PUBLIC_FIN_API_TOKEN`。

## A. 默认：这台 ECS 已有 Nginx Proxy Manager

宿主机 **80/443 已被 NPM 占用**。默认 compose **只起 api + web**，**不**绑定 80/443。

api 与 web 加入外部网络 `nginx-proxy-manage_default`（`FIN_PROXY_NETWORK` 可改）。NPM 用容器名解析 `web`。

```bash
sudo mkdir -p /opt && sudo git clone https://github.com/sunGday/yixing-finance.git /opt/yixing-finance
cd /opt/yixing-finance
cp deploy/.env.example deploy/.env   # 填 FIN_API_TOKEN；chmod 600
docker network ls | grep nginx-proxy-manage_default
cd deploy
docker compose up -d --build
docker compose ps    # 只有 api、web，没有 0.0.0.0:80 / 0.0.0.0:443
```

NPM → Proxy Hosts → `yunrong.ink`（以及 `www` 若需要）：

| 项 | 值 |
|---|---|
| Scheme | `http` |
| Forward Hostname / IP | `web` |
| Forward Port | `3000` |

**不要**加 Custom Location `/api/v1` → `api:8787`。方案 A：全部进 Next，BFF 再访问 `http://api:8787/api/v1` 并带上 Bearer。证书在 NPM 里申请（80/443 已经是 NPM 的）。

```bash
curl -sS https://yunrong.ink/api/v1/health
```

api 只 `expose 8787`，不映射到宿主机。数据卷：`/var/lib/yixing-finance/finance` → `/data/finance`（`FIN_DATA_DIR=/data/finance`）。`FIN_REQUIRE_TOKEN=1`。web 与 api 共用 `env_file` 里的 `FIN_API_TOKEN`。`FINANCE_API_INTERNAL_BASE=http://api:8787/api/v1`。

## B. 可选：没有 NPM 的机器（profile `bundled-nginx`）

只有这个 profile 会绑定 **80/443**。这台 ECS 不要开。

```bash
docker network create yixing-edge
# deploy/.env → FIN_PROXY_NETWORK=yixing-edge
cd deploy
docker compose --profile bundled-nginx up -d --build
```

自带 nginx **只**反代 `/` → `web:3000`，外加 `/.well-known/acme-challenge/`。见 `nginx/yunrong.ink.conf`。没有 `/api/v1` → api。

## C. systemd 备选（无 Docker）

见 `systemd/*.service`。宿主机反代（或 NPM）只把 `/` 转到 `127.0.0.1:3000`。不要把 `/api/v1` 转到 `8787`。API 听 `127.0.0.1:8787`。web 单元读取 `deploy/.env`，BFF 才能拿到 `FIN_API_TOKEN`。

## 回滚

临时备份仍可用既有 trycloudflare live 隧道。

## 生产约束

- api 容器内 `0.0.0.0:8787`，**不** publish 到宿主机公网。
- 必填：`FIN_API_TOKEN`、`FIN_REQUIRE_TOKEN=1`。CORS：`FIN_CORS_ORIGINS=https://yunrong.ink,https://www.yunrong.ink`。
- 前端服务端：`FINANCE_API_INTERNAL_BASE=http://api:8787/api/v1`。Bearer 只在 BFF 注入。禁止 `NEXT_PUBLIC_FIN_API_TOKEN`。
- 数据卷 rw：`/var/lib/yixing-finance/finance:/data/finance`。
