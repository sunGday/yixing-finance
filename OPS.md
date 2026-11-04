# yixing-finance 运维说明（holiday）· v0.4 · 2026-11-04

**只读 Omni**，不写任何广告/资金数据。密钥只在 `/home/box/.secrets/oppo-omniapi.env`（`OPPO_OWNER_ID/API_ID/API_KEY`），不进 git、不进日志。
可用 env：`OPPO_OMNI_ENV`（Omni env 文件路径）、`FIN_DATA_DIR`（落盘目录，默认 `../oppo-phase1/data/finance`，不在 git）、
`FIN_API_TOKEN`（设了即 Bearer 鉴权，否则 open-dev）、`FIN_REVENUE_MOCK=0`（关掉 mock 收入展示）、`FIN_CORS_ORIGINS`。

## 刷新（CLI，在 yixing-finance/ 下）
```
python3 scripts/refresh_finance.py recharges --start 20261001 --end 20261104   # billHis → billHis-1001108443-*.jsonl
python3 scripts/refresh_finance.py snapshot                                    # 子户余额快照 snapshots/snapshot-<今日>.json
python3 scripts/refresh_finance.py costs --start 2026-10-29 --end 2026-11-04    # 消耗 costs/cost-<日>.json（48子户×天，约 2s/调用）
python3 scripts/refresh_finance.py all                                         # 近7天充值 + 快照 + 近2天消耗（日常）
curl -XPOST http://127.0.0.1:8787/api/v1/admin/reload                          # 让 API 读到新文件
```
或直接 API：`POST /api/v1/admin/refresh/recharges?start_date=2026-11-01&end_date=2026-11-04`（`snapshot`、`costs`≤7天同理；有 FIN_API_TOKEN 需 Bearer）。
建议每日 23:50 跑 `snapshot`（越接近日终越准）+ 次日早跑 `costs` 补前一日完整值。

## 口径
- 充值 = `omni_parent_in`（=gen1_transfer_in，一代 1000015399→二代 billSub=300 存入），**user_locked**。平台直充/划拨/回收仅旁报。
- 收入 settlement_basis **user_locked**：日常可切预估/结算查看，**关账以 settled 为准**；毛利为「非关账」草稿。
- 消耗：queryAdData owner 级 DAY，分（x-uniform-currency-unit）。某子户失败 → 当日 cost=null（不填 0）。
- 余额：仅子户 totalBalance 快照（取数时刻）。代理商自身余额无读接口；首个快照 2026-11-04 之前无历史期初。

## 前端
Pages https://sungday.github.io/yixing-finance/ = **静态 fixtures**（非实时）。真数据只在本机 API `http://127.0.0.1:8787/api/v1`（jack Next rewrite → 8787）。不开公网 API 隧道。

## 启动
`cd yixing-finance && nohup uvicorn main:app --host 0.0.0.0 --port 8787 > /tmp/yixing-finance.log 2>&1 &`

## 收入渠道凭证（v0.5 · t294u）
Pangle/YLH 凭证经 API 录入（UI：jack `/settings/credentials`，schema 驱动），**不进 git、不进日志、GET 永不回显明文**。
- 存储：`$FIN_SECRETS_DIR/revenue-credentials.json`（file 0600，dir 0700，原子写）。`FIN_SECRETS_DIR` 未设时：`/var/lib/yixing-finance/secrets` 存在则用之，否则 box 用 `/home/box/.secrets/yixing-finance`（首次写入自动创建）。
- 可选加密：`FIN_CREDENTIALS_KEY`（Fernet key，`python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`）；设了就整文件加密，**丢 key = 需重录凭证**。key 只放 env，不与文件同目录。
- 优先级：**进程 env > 文件**（运维可用 env 紧急覆盖；GET 中该字段 `source:"env"`、`overridden_by_env:true`）。写入/删除后热加载进当前进程，无需重启。
- 查看状态：`GET /api/v1/health` → `credentials:{pangle,ylh}` = `configured|partial|missing`。
- 录入（有 token 时加 `-H "Authorization: Bearer $FIN_API_TOKEN"`）：
```
curl -XPUT   $B/credentials/pangle -H 'Content-Type: application/json' -d '{"fields":{"PANGLE_USER_ID":"…","PANGLE_ROLE_ID":"…","PANGLE_SECURE_KEY":"…"}}'
curl -XPATCH $B/credentials/ylh    -H 'Content-Type: application/json' -d '{"fields":{"YLH_SECRET":""}}'   # 空串=清除
curl -XDELETE $B/credentials/pangle
```
- 穿山甲凭证齐全后 `GET /revenues` **真拉**预估收入（`source:"live"`，`amount_fen` 为分）。不再出现 `live_fetch_unverified:pangle`。优量汇未接真拉：缺凭证仍是 `credential_missing:ylh`，**不要**因此把整页打成 503。只请求优量汇且无凭证、或两个网络都无凭证，且 `strict=true` / `FIN_REVENUE_MOCK=0` 时才 503 `50301`。收入仍是 estimated，不关账。
- 核对（密钥已在 credentials 文件里，不要把值写进命令历史以外的地方，更不要提交）：
```
B=http://127.0.0.1:8787/api/v1
# 脱敏：hint 形如 1***25，响应里没有 Secure Key
curl -sS "$B/credentials/pangle"
# 选一个 CSJ 里有收入、且早于今天（上海）的日期
curl -sS "$B/revenues?date=YYYY-MM-DD"
# 期望 HTTP 200、code=0、至少一条 ad_network=pangle source=live 的行；
# gap_flags 不含 live_fetch_unverified:pangle；若未配优量汇则含 credential_missing:ylh
```
  同一天可用官方 CLI 对照（env 与文件字段对应：`CSJ_MEDIA_ID`=`PANGLE_USER_ID`，`CSJ_ROLE_ID`=`PANGLE_ROLE_ID`，`CSJ_SECURITY_KEY`=`PANGLE_SECURE_KEY`）：
```
csj-cli report income --date YYYY-MM-DD --region cn
```
  单测不打外网：`python3 -m unittest tests.test_pangle_income tests.test_api tests.test_overview -v`（HTTP 已 mock）。
- **v0.6 总览**用同一套 `PANGLE_*` 请求 GroMore 日报（`/union_media/open/api/mediation/get_daily_income_report_data`，主机可用 `CSJ_API_BASE` 覆盖）。无凭证或请求失败时，总览只加总该区间的 live `rt/income` 穿山甲行，不用 mock。
- **结算单**写在 `$FIN_DATA_DIR/settlements.json`（ECS 上即 `/data/finance/settlements.json`），与 secrets 分开，勿把密钥写进 `evidence_ref`。完成签订记 `settled`（正式入账金额）；`paid` 只表示已收款。`estimated` 不能写入该文件。
- ECS：`sudo install -d -m 700 -o <api运行用户> /var/lib/yixing-finance/secrets`；docker 挂 `/var/lib/yixing-finance/secrets:/data/secrets` + `FIN_SECRETS_DIR=/data/secrets`；systemd(www-data) 则 `chown www-data` 该目录。备份时按密钥对待。
