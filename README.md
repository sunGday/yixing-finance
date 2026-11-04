# yixing-finance（REQ-20261104-10C · v0.2 草案骨架）

**状态：草案；本地已整理，尚未 push。**  
目标仓：[`sunGday/yixing-finance`](https://github.com/sunGday/yixing-finance)（空仓需用户在 GitHub 创建并授权后再推）。不启投、不写 Omni、不发穿山甲/优量汇真实 HTTP。密钥不入库。

- 看草案：`API-DRAFT.md`
- 代码：`adapters/{base,pangle,ylh}.py`、`sources/omni_billhis.py`、`reconcile.py`
- 单测：`cd yixing-finance && python3 -m unittest discover -s tests -t . -v`

## 已锁定口径（user_locked）
- 充值 `basis=omni_parent_in`：一代→二代入账 = 充值；平台直充 / 划拨 / 回收旁报
- `settlement_basis`：日常可切换预估/结算；关账以结算为准

## env 名（只列名，值放 env/.secrets，绝不入库）
`FIN_API_TOKEN`；`PANGLE_USER_ID` `PANGLE_ROLE_ID` `PANGLE_SECURE_KEY`；`YLH_MEMBER_ID` `YLH_SECRET`（别名 `GDT_MEMBER_ID` `GDT_SECRET`）；Omni 沿用既有 `oppo-omniapi` 配置。

⚠ 穿山甲/优量汇 endpoint 与签名算法均为「待复核」占位。

## 运行 API（v0.3 · FastAPI）
```bash
cd /workspace/team/mario-backend/yixing-finance
pip install -r requirements.txt
FIN_API_TOKEN=devtoken uvicorn main:app --host 0.0.0.0 --port 8787
```
- Base URL（同机）：`http://127.0.0.1:8787/api/v1`；端点 `health` `recharges` `recharges/summary` `revenues` `reconcile/summaries` `costs`(stub) `snapshots`(stub)
- 鉴权：`Authorization: Bearer $FIN_API_TOKEN`；未设 env → 开发放行并回 `X-Auth-Mode: open-dev`；错/缺 token → 401 `40101`
- CORS：`FIN_CORS_ORIGINS`（逗号分隔，默认 `*`，上线前收紧）
- 充值数据：只读 Omni billHis JSONL 缓存（自动搜 `../**/billHis-1001108443-*.jsonl`，或 `FIN_RECHARGE_JSONL` 指定）
- 收入：无 PANGLE_*/YLH_* → 返回 `source:"mock"` + `gap_flags: credential_missing:*`；`?strict=true` 或 `FIN_REVENUE_MOCK=0` → 503 `50301`；mock 不进对账
- 单测：`python3 -m unittest discover -s tests -t . -v`
