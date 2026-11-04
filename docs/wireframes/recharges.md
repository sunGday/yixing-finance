# 充值流水 · 线框
Web：筛选[日期/快捷][代理商🔒][子客户多选][资金类型: 充值|消耗|余额快照|全部][关键词 txn_id][元|分]
KPI：充值合计 · 笔数 · 扣回合计 · 日均
图：biz_date 日桶柱（小时预留隐藏）
表：txn_time | biz_date | txn_id | to_owner_id+名 | amount_fen | direction | channel | from_party | balance_after_fen | status | 证据
合计吸底；reversed 删除线；MANUAL- 显示「人工」
移动：卡片 = 时间 / 子户 / 金额 / 状态；点开全字段
空：「所选区间无充值记录」；部分：「OMNI 拉取失败，request_id …」
