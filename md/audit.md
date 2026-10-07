# RCS 审计与告警域接口文档（audit）

> 服务链路：前端 → gateway-api（HTTP，:8110）→ rcs-audit（gRPC，:9093）→ PostgreSQL
> 契约源头：`gateway-api/auditapi/audit.api`（HTTP 层）、`rpc/audit/audit.proto`（rpc 层）

## 通用约定

- **响应信封**：所有接口统一返回 `{code, message, data}`，`code=0` 表示成功
- **分页约定**：列表接口传 `limit`（每页条数）+ `page`（页码，从 1 起；0 视为 1，负数 40001），响应 data 为 `{total, items}` 标准分页结构；`limit<=0 或 >1000` 时回落默认值（活动告警列表 / 审计事实列表 100，处置时间线 20）
- **可空字段**：空字符串表示 NULL（未填写的字段在响应中不出现）
- **时间格式**：RFC3339Nano 字符串
- **错误码**：

| code | HTTP 状态 | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 40001 | 200 | 参数错误（必填缺失、枚举非法、状态机跳步等） |
| 40401 | 200 | 告警不存在 |
| 40901 | 200 | 冲突（并发处置被抢先、已关闭再处置） |
| 50001 | 500 | 服务器内部错误 |

## 数据模型与状态机

audit 域三张业务表：`rcs_audit_event`（审计事实流水，只追加）、`rcs_audit_active_alert`（活动告警投影，按 alert_key 归并一行一条）、`rcs_audit_alert_lifecycle_event`（告警处置账本，复合主键 (alert_key, sequence)，只追加）。

告警处置状态机（**严格链式**，UpdateAlert 校验）：

| 当前状态 | 允许流转到 | 处置动作 |
|---|---|---|
| ACTIVE | ACKNOWLEDGED | ACKNOWLEDGE（确认受理） |
| ACKNOWLEDGED | RESOLVED | RESOLVE（解决） |
| RESOLVED | CLOSED | CLOSE（关闭） |
| CLOSED | 终态，禁止再处置 | — |

告警触发语义（内部 rpc RaiseAlert，不对前端开放）：新告警写投影 + RAISED 账本事件（from=NULL）；已存在且未关闭则归并（occurrences+1、刷新 last_seen_at，不写事件）；**已 CLOSED 的告警再次触发则重新激活并清零**（status 回 ACTIVE、occurrences=1、first_seen_at 刷新、处置痕迹清空，补 RAISED 事件 from=CLOSED）。

## 接口总览

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/alerts | 活动告警面板（分页 + 状态过滤） |
| PUT | /api/alerts | 处置告警（status 原子裁决 + 严格链式状态机） |
| GET | /api/alerts/events | 告警处置时间线（账本分页） |
| GET | /api/audit-events | 审计事实流水（操作日志页，分页） |
| POST | /api/audit-migrations | 审计迁移开批导入（migration_id 幂等） |
| GET | /api/audit-migrations | 审计迁移批次列表（分页） |
| GET | /api/audit-migrations/:id | 审计迁移批次详情（run + items） |
| POST | /api/audit-migrations/:id/rollback | 回滚审计迁移批次（整批退回） |

---

## 1. 活动告警列表

`GET /api/alerts`

**作用**：查询当前活动告警投影（rcs_audit_active_alert），支持处置状态过滤与分页。

**效果**：纯查询，无副作用。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| status | string | 否 | 按处置状态过滤（ACTIVE/ACKNOWLEDGED/RESOLVED/CLOSED）；空 = 不过滤 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`——total 为满足过滤条件的总条数，items 为告警数组（按 last_seen_at 倒序）。

**单条告警字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| alert_key | string | 告警归并键（同源告警按它合并一行） |
| code / message | string | 告警码 / 告警内容 |
| first_seen_at / last_seen_at | string | 最早 / 最近发现时间 |
| occurrences | int | 出现次数（归并累加；重激活后清零重计） |
| business_task_id / transport_order_id / vda_order_id / vehicle_id | string | 业务关联标识（可空） |
| status | string | 处置状态（4 值枚举） |
| assignee | string | 处置人（ACKNOWLEDGE 时写入，可空） |
| acknowledged_at / resolved_at / closed_at | string | 三个处置时间戳（可空） |
| last_actor / last_reason | string | 最近一次操作痕迹（可空） |

**示例**：

```json
GET /api/alerts?status=ACTIVE&limit=10&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 3,
  "items": [
    {"alert_key": "vehicle:agv-01:battery_low", "code": "BATTERY_LOW",
     "message": "车辆电量低于 20%", "occurrences": 2, "status": "ACTIVE",
     "first_seen_at": "...", "last_seen_at": "...", ...}
  ]
}}
```

---

## 2. 处置告警

`PUT /api/alerts`

**作用**：推进告警处置状态机一步（严格链式），并追加一条处置事件。

**效果**：
- 更新 rcs_audit_active_alert 投影（status、按动作落处置时间/处置人、last_actor/last_reason）+ 追加 rcs_audit_alert_lifecycle_event 账本一条，同事务
- **status 原子裁决**：严格链式下每个状态仅一个合法后继，`WHERE status = 前置状态` 原子更新是唯一裁决点——重放第二次时状态已前进，矩阵校验（含自身）拒绝；双人并发处置只有一人成功
- 事件 from_status 由服务端事务内读取（调用方不可传）

**请求体**（alert_key 放 body 而非路径，规避冒号等特殊字符的 URL 编码问题）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| alert_key | string | 是 | 告警归并键（列表接口返回） |
| action | string | 是 | 处置动作（ACKNOWLEDGE/RESOLVE/CLOSE） |
| actor | string | 是 | 操作主体（审计；系统流转传 SYSTEM） |
| reason | string | 是 | 处置原因（审计） |
| assignee | string | 否 | 处置人（ACKNOWLEDGE 时写入） |

**错误场景**：

| 场景 | 响应 |
|---|---|
| 告警不存在 | 200 + 40401 |
| 必填缺失 / 动作非法 | 200 + 40001 |
| 状态机跳步（如 ACTIVE 直接 RESOLVE） | 200 + 40001「非法状态迁移 X -> Y」 |
| 重放（同一处置请求发第二次） | 200 + 40001「非法状态迁移 X -> X」 |
| 并发处置（他人已抢先推进状态） | 200 + 40901「告警状态已变化，请刷新后重试」 |
| CLOSED 再处置 | 200 + 40901「告警已关闭，不可再处置」 |

**示例**：

```json
// 请求（ACTIVE → ACKNOWLEDGED）
PUT /api/alerts
{"alert_key": "vehicle:agv-01:battery_low", "action": "ACKNOWLEDGE",
 "actor": "张三", "reason": "受理排查", "assignee": "张三"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "alert_key": "vehicle:agv-01:battery_low", "status": "ACKNOWLEDGED",
  "assignee": "张三", "acknowledged_at": "...", ...}}
```

---

## 3. 告警处置时间线

`GET /api/alerts/events`

**作用**：查询某告警的处置账本（rcs_audit_alert_lifecycle_event），还原完整处置经过。

**效果**：纯查询，无副作用。告警不存在 → 200 + 40401。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| alert_key | string | 是 | 告警归并键 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 20 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`，items 按 sequence 升序。

**单条事件字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| sequence | int | 事件序号（1 起，每告警独立编号） |
| action | string | 处置动作（RAISED/ACKNOWLEDGED/RESOLVED/CLOSED） |
| from_status | string | 迁移前状态（首条 RAISED 为空；重激活的 RAISED 为 CLOSED） |
| to_status | string | 迁移后状态 |
| actor / assignee / reason | string | 操作痕迹（可空） |
| occurred_at | string | 发生时间（RFC3339Nano） |

**示例**：

```json
GET /api/alerts/events?alert_key=vehicle:agv-01:battery_low&limit=20&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 4,
  "items": [
    {"sequence": 1, "action": "RAISED", "to_status": "ACTIVE", "occurred_at": "..."},
    {"sequence": 2, "action": "ACKNOWLEDGED", "from_status": "ACTIVE",
     "to_status": "ACKNOWLEDGED", "actor": "张三", ...},
    {"sequence": 3, "action": "RESOLVED", "from_status": "ACKNOWLEDGED",
     "to_status": "RESOLVED", "actor": "张三", ...},
    {"sequence": 4, "action": "CLOSED", "from_status": "RESOLVED",
     "to_status": "CLOSED", "actor": "李四", ...}
  ]
}}
```

---

## 4. 审计事实流水

`GET /api/audit-events`

**作用**：查询审计事实账本（rcs_audit_event），即系统「发生了什么」的全量流水（操作日志页）。

**效果**：纯查询，无副作用。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`，items 按 occurred_at 倒序（最新在前）。

**单条事件字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 事件 ID（调用方提供） |
| occurred_at | string | 发生时间 |
| kind | string | 事件类别（如 CONTROL_OPERATION） |
| actor / reason | string | 操作主体 / 原因（可空） |
| business_task_id / transport_order_id / vda_order_id / vehicle_id | string | 业务关联标识（可空） |
| summary | object | 事件载荷（JSON，格式随 kind 变化） |

**示例**：

```json
GET /api/audit-events?limit=20&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 152,
  "items": [
    {"id": "evt-001", "occurred_at": "...", "kind": "CONTROL_OPERATION",
     "transport_order_id": "to-123", "summary": {"result": "success", ...}}
  ]
}}
```

---

## 5. 审计迁移开批导入

`POST /api/audit-migrations`

**作用**：把旧系统的审计历史批量导入（一批一次，migration_id 幂等），留完整台账供对账与回滚。

**效果**：
- 服务端对清单整体计算 manifest_sha256 写入 run 表（批次封面）
- 按 record_type 分流两路（同事务，批量多值写）：
  - ENTRY → rcs_audit_event：id 已存在 → SKIPPED_SAME；否则原样插入（流水不可替换）
  - ALERT → rcs_audit_active_alert：alert_key 已存在 → SKIPPED_SAME；否则原样插入（导入=搬运，不做归并）
- **幂等**：migration_id 已存在 → 40901「迁移批次已存在」

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| migration_id | string | 是 | 批号（幂等键，≤128） |
| actor | string | 是 | 执行主体（审计，≤255） |
| items | array | 是 | 清单（至少 1 条；批内 (record_type, record_id) 不允许重复） |
| items[].record_type | string | 是 | ENTRY（审计事实）/ ALERT（活动告警） |
| items[].record_id | string | 是 | ENTRY=事件 id；ALERT=alert_key（≤1024） |
| items[].content | string | 是 | 记录内容 JSON 文本（ENTRY=AuditEvent / ALERT=AuditActiveAlert 结构；内部主键须与 record_id 一致） |
| items[].content_sha256 | string | 是 | 内容指纹（十六进制 64 字符；服务端重算校验，不一致 40001） |

**响应 data**：`{migration_id, inserted, skipped}`。

**错误场景**：

| 场景 | 响应 |
|---|---|
| migration_id 已存在 | 200 + 40901「迁移批次已存在」 |
| 非法 record_type / 清单内重复 | 200 + 40001 |
| 内容哈希不一致 / 内部主键与 record_id 不一致 | 200 + 40001 |
| 清单为空 / 必填缺失 | 200 + 40001 |

**示例**：

```json
// 请求（1 条流水 + 1 条告警）
POST /api/audit-migrations
{"migration_id": "AUDMIG-20260905-001", "actor": "chenpeng", "items": [
  {"record_type": "ENTRY", "record_id": "evt-0001",
   "content": "{\"id\":\"evt-0001\",\"occurred_at\":\"2026-08-01T10:00:00Z\",\"kind\":\"CONTROL_OPERATION\",\"summary\":{}}",
   "content_sha256": "abc...64位"},
  {"record_type": "ALERT", "record_id": "vehicle:agv-01:battery_low",
   "content": "{\"alert_key\":\"vehicle:agv-01:battery_low\",\"code\":\"BATTERY_LOW\",\"status\":\"ACTIVE\",\"occurrences\":3}",
   "content_sha256": "def...64位"}
]}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "migration_id": "AUDMIG-20260905-001", "inserted": 2, "skipped": 0
}}
```

---

## 6. 审计迁移批次列表

`GET /api/audit-migrations`

**作用**：查询审计迁移批次台账（rcs_audit_migration_run），按应用时间倒序。

**效果**：纯查询，无副作用。

**查询参数**：limit（<=0 或 >1000 取默认 100）、page（从 1 起；0 视为 1，负数 40001）。

**响应 data**：`{total, items}`。单条 run 字段：migration_id、applied_at、rolled_back_at（可空）、actor、manifest_sha256。

---

## 7. 审计迁移批次详情

`GET /api/audit-migrations/:id`

**作用**：按批号查询 run + 全部 item（明细台账）。

**效果**：纯查询，无副作用。批次不存在 → 200 + 40401。

**响应 data**：`{run, items}`。单条 item 字段：record_type、record_id、content_sha256、action（INSERTED/SKIPPED_SAME）、rolled_back_at（可空：仅 INSERTED 条目回滚后出现）。

---

## 8. 回滚审计迁移批次

`POST /api/audit-migrations/:id/rollback`

**作用**：整批退回该批 INSERTED 的条目（批次级，不支持部分回滚），台账盖时间戳留痕。

**效果**：
- ENTRY：按 id 删除 rcs_audit_event 行；ALERT：先清该 alert_key 的处置事件（外键），再删告警行
- 仅 INSERTED 的 item 盖 rolled_back_at；run 盖 rolled_back_at；SKIPPED_SAME 无动作不盖
- 台账只标记不删行

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| actor | string | 是 | 回滚执行主体（审计，≤255） |

**错误场景**：

| 场景 | 响应 |
|---|---|
| 批次不存在 | 200 + 40401 |
| 已回滚再回滚 | 200 + 40901「迁移批次已回滚」 |

**示例**：

```json
POST /api/audit-migrations/AUDMIG-20260905-001/rollback
{"actor": "chenpeng"}

HTTP 200
{"code": 0, "message": "ok"}
```

---

## 附：内部接口说明

- `InsertEvent` / `RaiseAlert` / `InsertAlertLifecycleEvent`（rpc）：审计数据的写入口，**不对前端开放**，供内部服务（未来 MQTT 网关、task 服务等）直连 rpc 使用。
- 告警投影（rcs_audit_active_alert）与处置账本（rcs_audit_alert_lifecycle_event）为同事务双写：处置与触发路径由服务端在行锁保护下 MAX+1 分配 sequence，历史链条不缺号；旧通道 InsertAlertLifecycleEvent 保留（sequence 由调用方提供）。
