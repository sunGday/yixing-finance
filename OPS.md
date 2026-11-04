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
