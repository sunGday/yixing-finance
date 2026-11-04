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
