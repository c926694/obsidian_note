# RCS 任务域接口文档（task）

> 服务链路：前端 → gateway-api（HTTP，:8110）→ rcs-task（gRPC，:9091）→ PostgreSQL
> 契约源头：`gateway-api/taskapi/task.api`（HTTP 层）、`rpc/task/task.proto`（rpc 层）

## 通用约定

- **响应信封**：所有接口统一返回 `{code, message, data}`，`code=0` 表示成功
- **分页约定**：列表接口传 `limit`（每页条数）+ `page`（页码，从 1 起；0 视为 1，负数 40001），响应 data 为 `{total, items}` 标准分页结构
- **可空字段**：空字符串表示 NULL（创建后未填写的字段在响应中不出现）
- **时间格式**：RFC3339Nano 字符串
- **ID 格式校验**：business_task_id 为 uuid 列，空或非 uuid 格式 → 40001「business_task_id 不是合法的 uuid 格式」（拦截器按 proto 校验规则产出）；格式合法但不存在才是 40401
- **错误码**：

| code | HTTP 状态 | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 40001 | 200 | 参数错误（必填缺失、枚举非法、动作与状态不一致等） |
| 40401 | 200 | 任务不存在 |
| 40901 | 200 | 冲突（创建幂等命中、版本过期、终态再流转） |
| 50001 | 500 | 服务器内部错误 |

## 状态机与动作枚举

任务业务状态（business_state）9 个英文枚举：`PENDING / ACCEPTED / DISPATCHING / EXECUTING / PAUSED / EXCEPTION / COMPLETED / FAILED / CANCELLED`。

合法迁移矩阵（UpdateTask 校验）：

| 当前状态 | 允许流转到 |
|---|---|
| PENDING | ACCEPTED、CANCELLED |
| ACCEPTED | DISPATCHING、CANCELLED |
| DISPATCHING | EXECUTING、EXCEPTION、FAILED、CANCELLED |
| EXECUTING | PAUSED、EXCEPTION、COMPLETED、FAILED、CANCELLED |
| PAUSED | EXECUTING、FAILED、CANCELLED |
| EXCEPTION | EXECUTING、CANCELLED |
| COMPLETED / FAILED / CANCELLED | 终态，禁止再流转 |

处置动作（action）与目标状态的唯一映射：

| action | 含义 | 对应 after_state |
|---|---|---|
| ACCEPT | 受理 | ACCEPTED |
| DISPATCH | 派单 | DISPATCHING |
| EXECUTE | 开始执行 | EXECUTING |
| PAUSE | 暂停 | PAUSED |
| RESUME | 恢复 | EXECUTING |
| EXCEPTION | 异常 | EXCEPTION |
| COMPLETE | 完成 | COMPLETED |
| FAIL | 失败 | FAILED |
| CANCEL | 取消 | CANCELLED |

## 接口总览

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/tasks | 创建任务（幂等） |
| GET | /api/tasks/:id | 查询任务详情 |
| PUT | /api/tasks/:id | 更新任务状态（version 乐观锁） |
| GET | /api/tasks | 任务列表（分页 + 状态过滤） |
| GET | /api/tasks/:id/events | 任务时间线（事件账本分页） |

---

## 1. 创建任务

`POST /api/tasks`

**作用**：创建一个任务，初始状态「PENDING」，并写入首条状态事件。

**效果**：
- 服务端生成 uuidv7 作为 business_task_id（业务主键）
- rcs_task_state 投影 + rcs_task_state_event 首条事件（sequence=1）同事务写入
- 响应中 action_* 三个字段为数据库默认值（`{}`/`[]`/`[]`）
- **幂等**：request_id 重复时不重复插入、不追加事件，返回首次创建的任务 + code 40901

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| request_id | string | 否 | 调用方幂等标识（表唯一约束，重复则命中幂等） |
| transport_order_id | string | 否 | openTCS 运输订单标识（表唯一约束） |
| vda_order_id | string | 否 | VDA 5050 订单标识 |
| vehicle_id | string | 否 | 目标车辆 |
| actor | string | 否 | 操作主体 |
| reason | string | 否 | 创建原因 |
| profile_version | string | 否 | 车辆配置档案版本（VEHICLE_PROFILES 文档的 revision） |

**响应 data**：TaskInfo（18 字段，见下）。

**示例**：

```json
// 请求
POST /api/tasks
{"request_id": "req-001", "vehicle_id": "agv-01", "actor": "张三", "reason": "创建任务"}

// 响应（首次创建）
HTTP 200
{"code": 0, "message": "ok", "data": {
  "business_task_id": "01a06608-371a-7bc1-89e8-8bbe9c23087e",
  "business_state": "PENDING", "version": 0,
  "vehicle_id": "agv-01",
  "created_at": "2026-09-03T14:20:00.123456789+08:00",
  "updated_at": "2026-09-03T14:20:00.123456789+08:00",
  "action_transport_order_ids": {}, "action_dispatch_facts": [], "action_execution_facts": []
}}

// 响应（幂等命中，同 request_id 重发）
HTTP 200
{"code": 40901, "message": "任务已存在", "data": { ...首次创建的任务... }}
```

---

## 2. 查询任务详情

`GET /api/tasks/:id`

**作用**：按 business_task_id 查询任务当前状态（投影）。

**效果**：纯查询，无副作用。

**路径参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | business_task_id（创建任务时服务端返回） |

**响应 data**：TaskInfo。任务不存在 → 200 + 40401；ID 空或非 uuid 格式 → 200 + 40001「business_task_id 不是合法的 uuid 格式」。

**TaskInfo 字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| business_task_id | string | 业务任务 ID（uuidv7） |
| business_state | string | 业务状态（9 个英文枚举） |
| version | int | 乐观锁版本号，初始 0，每次更新 +1 |
| request_id | string | 调用方幂等标识（可空） |
| transport_order_id / vda_order_id / vehicle_id | string | 业务关联标识（可空） |
| dispatch_state / vehicle_state | string | 调度/车辆状态（可空，待 MQTT 网关填充） |
| last_vehicle_observed_at | string | 最近观测时间（可空） |
| profile_version / control_owner | string | 配置版本 / 控制所有者（control_owner 创建时默认 LEGACY_RCS） |
| pending_operation | object | 待处理操作（JSON，可空） |
| action_transport_order_ids | object | 派单动作关联的运输订单（默认 {}） |
| action_dispatch_facts / action_execution_facts | array | 派单/执行事实（默认 []） |
| created_at / updated_at | string | 创建/更新时间 |

---

## 3. 更新任务状态

`PUT /api/tasks/:id`

**作用**：推进任务状态机一步（合法迁移），并追加一条状态事件。

**效果**：
- 更新 rcs_task_state 投影（business_state、version+1、updated_at）+ 追加 rcs_task_state_event 账本一条，同事务
- **version 乐观锁**：`WHERE version = 请求值` 原子裁决，不匹配 → 40901「任务版本已过期，请刷新后重试」
- **防重放**：同一请求发第二次，version 已变化，必然 40901
- 事件 before_state 由服务端事务内读取（调用方不可传）

**路径参数**：id（必填，business_task_id）

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| after_state | string | 是 | 目标状态（9 个英文枚举），必须与当前状态构成合法迁移 |
| version | int | 是 | 乐观锁：调用方看到的当前版本号（GET 详情获取，初始 0） |
| action | string | 否 | 处置动作（9 值枚举）；传了必须与 after_state 对应（如 ACCEPT→ACCEPTED），否则 40001 |
| actor | string | 是 | 操作主体（审计；系统流转传 SYSTEM） |
| reason | string | 是 | 流转原因（审计） |

**错误场景**：

| 场景 | 响应 |
|---|---|
| 任务不存在 | 200 + 40401 |
| ID 空或非 uuid 格式 | 200 + 40001「business_task_id 不是合法的 uuid 格式」 |
| 必填缺失 / 枚举非法 / action 与 after_state 不一致 / version 负数 | 200 + 40001 |
| version 过期（并发冲突/重放） | 200 + 40901「任务版本已过期」 |
| 终态再流转 | 200 + 40901「任务已终结」 |
| 矩阵外迁移（如 PENDING → COMPLETED） | 200 + 40001「非法状态迁移 X -> Y」 |

**示例**：

```json
// 请求（PENDING → ACCEPTED）
PUT /api/tasks/01a06608-371a-7bc1-89e8-8bbe9c23087e
{"after_state": "ACCEPTED", "action": "ACCEPT", "actor": "李四", "reason": "人工校验通过", "version": 0}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": { "business_task_id": "...", "business_state": "ACCEPTED", "version": 1, ... }}
```

---

## 4. 任务列表

`GET /api/tasks`

**作用**：查询任务列表，支持状态过滤与分页。

**效果**：纯查询，无副作用。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| status | string | 否 | 按业务状态过滤（英文枚举字面量）；空 = 不过滤 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`——total 为满足过滤条件的总条数，items 为 TaskInfo 数组（按 created_at 倒序）。

**示例**：

```json
GET /api/tasks?status=PENDING&limit=10&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 37,
  "items": [ { "business_task_id": "...", "business_state": "PENDING", ... }, ... ]
}}
```

---

## 5. 任务时间线

`GET /api/tasks/:id/events`

**作用**：查询任务的状态事件账本（rcs_task_state_event），还原完整状态流转历史。

**效果**：纯查询，无副作用。

**路径参数**：id（必填，business_task_id）。任务不存在 → 200 + 40401；ID 空或非 uuid 格式 → 200 + 40001「business_task_id 不是合法的 uuid 格式」。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| limit | int | 否 | 每页条数；<=0 取默认 20，超过 1000 截为 1000（与列表接口的回落语义不同） |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`，items 按 sequence 升序（从创建到现在）。

**单条事件字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| sequence | int | 事件序号（1 起，每任务独立编号） |
| before_state | string | 迁移前状态（首条事件为空） |
| after_state | string | 迁移后状态 |
| source | string | 触发通道（当前为 API，未来有 MQTT） |
| action | string | 处置动作（可空） |
| actor | string | 操作主体（可空） |
| reason | string | 流转原因（可空） |
| occurred_at | string | 发生时间（RFC3339Nano） |

**示例**：

```json
GET /api/tasks/01a06608-371a-7bc1-89e8-8bbe9c23087e/events?limit=20&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 7,
  "items": [
    {"sequence": 1, "after_state": "PENDING", "source": "API", "actor": "张三",
     "reason": "链式演示：创建任务", "occurred_at": "2026-09-03T14:20:00.1+08:00"},
    {"sequence": 2, "before_state": "PENDING", "after_state": "ACCEPTED", "source": "API",
     "action": "ACCEPT", "actor": "李四", "reason": "人工校验通过，物料齐备", ...},
    ...
    {"sequence": 7, "before_state": "EXECUTING", "after_state": "COMPLETED", "source": "API",
     "action": "COMPLETE", "actor": "王五", "reason": "搬运完成，货物已就位", ...}
  ]
}}
```

---

## 附：内部接口说明

- `GetTaskByRequestID`（rpc）：按 request_id 查询任务，**不对前端开放**，仅供网关在创建任务幂等命中（40901）时兜底查回首次创建的任务，补全响应 data。
- 事件账本（rcs_task_state_event）与投影（rcs_task_state）为同事务双写：每次状态变化必留一条事件，sequence 由服务端在行锁保护下 MAX+1 分配，历史链条永不缺号。
