# RCS 控制面文档域接口文档（document）

> 服务链路：前端 → gateway-api（HTTP，:8110）→ rcs-document（gRPC，:9092）→ PostgreSQL
> 契约源头：`gateway-api/documentapi/document.api`（HTTP 层）、`rpc/document/document.proto`（rpc 层）

## 定位

控制面文档（rcs_control_plane_document）是**受控文件资料库**：存放给调度系统和车辆用的配置与资料（车辆档案、地图包、发布方案等），特点是会升级、改必有记录、使用前可验真。

## 通用约定

- **响应信封**：所有接口统一返回 `{code, message, data}`，`code=0` 表示成功
- **分页约定**：列表接口传 `limit`（<=0 或 >1000 取默认 100）+ `page`（从 1 起；0 视为 1，负数 40001），响应 data 为 `{total, items}` 标准分页结构
- **content 约定**：文档内容为任意合法 JSON（列类型 jsonb，入库时 PostgreSQL 规范化存储：键排序、去空格）；接口层 json.RawMessage 原样透传
- **可空字段**：空字符串表示 NULL
- **时间格式**：RFC3339Nano 字符串
- **错误码**：

| code | HTTP 状态 | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 40001 | 200 | 参数错误（必填缺失、content 不是合法 JSON、page 负数） |
| 40401 | 200 | 文档不存在 |
| 50001 | 500 | 服务器内部错误 |

## 文档类别（document_type）

| 类别 | 含义 |
|---|---|
| VEHICLE_PROFILES | 车辆配置档案（速度/尺寸/载重等参数，revision 版本链） |
| MAP_PACKAGES | 地图包（站台、地图文件地址） |
| VEHICLE_MAP_BINDINGS | 车辆-地图绑定（哪辆车用哪张图，状态机） |
| FAT_RELEASES | FAT 出厂验收发布（车+配置+地图三元组） |
| FORKLIFT_ACTION_TEMPLATES | 叉车作业动作模板（站台+动作类型） |
| PRODUCTION_FAT_SESSIONS | 生产 FAT 验收会话 |
| SEER_G4_RELEASES | Seer G4 车型发布方案（车+配置+地图+起终点站，审批流） |

> 说明：上表是**约定用途**（前端按这些类别组织页面），**不是白名单**——接口只校验长度（≤64），任意字符串都能入库，新增类别不必改后端代码。

## 接口总览

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/documents | 创建文档（revision=1） |
| GET | /api/documents/:type/:id | 查询文档当前版本 |
| GET | /api/documents | 文档列表（分页 + 类别过滤） |
| PUT | /api/documents/:type/:id | 更新文档（revision 递增） |
| POST | /api/migrations | 开批导入（迁移，migration_id 幂等） |
| GET | /api/migrations | 迁移批次列表（分页） |
| GET | /api/migrations/:id | 迁移批次详情（run + items） |
| POST | /api/migrations/:id/rollback | 回滚迁移批次（整批退回） |

---

## 1. 创建文档

`POST /api/documents`

**作用**：存入一份新档案，revision 从 1 开始。

**效果**：
- 服务端计算 content 的 SHA-256 摘要并落库
- 写入 CREATED 事件（审计：谁在什么时候创建了哪份档案）
- 同 (document_type, document_id) 重复创建 → 主键冲突（当前返回 50001，业务上应先查询或走更新接口）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| document_type | string | 是 | 文档类别（≤64；约定用途见上表，非白名单） |
| document_id | string | 是 | 类别内文档 ID |
| content | JSON | 是 | 文档内容（任意合法 JSON） |
| source_ref | string | 否 | 来源引用 |
| actor | string | 否 | 操作主体 |
| reason | string | 否 | 创建原因 |

**示例**：

```json
// 请求
POST /api/documents
{"document_type": "VEHICLE_PROFILES", "document_id": "agv-standard",
 "content": {"maxSpeed": 1.5, "width": 0.8},
 "source_ref": "厂商手册 v2", "actor": "张三", "reason": "新车建档"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "document_type": "VEHICLE_PROFILES", "document_id": "agv-standard",
  "revision": 1, "content": {"maxSpeed": 1.5, "width": 0.8},
  "content_sha256": "9f86d0...", "created_at": "...", "updated_at": "..."
}}
```

---

## 2. 查询文档详情

`GET /api/documents/:type/:id`

**作用**：查询文档**当前版本**（最新 revision）。历史版本查询接口待调度阶段补充。

**路径参数**：type（文档类别）、id（类别内文档 ID），均必填。文档不存在 → 200 + 40401。

**响应 data**：DocumentInfo。

| 字段 | 类型 | 说明 |
|---|---|---|
| document_type / document_id | string | 类别与 ID |
| revision | int | 当前修订号（从 1 递增） |
| content | JSON | 文档内容 |
| content_sha256 | string | 内容 SHA-256 摘要 |
| source_ref | string | 来源引用（可空） |
| migration_id | string | 迁移批次标记（可空） |
| created_at / updated_at | string | 创建/更新时间 |

---

## 3. 文档列表

`GET /api/documents`

**作用**：按类别查询文档，标准分页。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| type | string | 否 | 按类别过滤；空 = 查全部 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`，items 为 DocumentInfo 数组（按 document_type, document_id 排序）。

**示例**：

```json
GET /api/documents?type=VEHICLE_PROFILES&limit=20&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 12,
  "items": [ {"document_type": "VEHICLE_PROFILES", "document_id": "agv-standard", "revision": 3, ...}, ... ]
}}
```

---

## 4. 更新文档

`PUT /api/documents/:type/:id`

**作用**：更新档案内容，revision 由服务端递增（+1）。

**效果**：
- 重算 content SHA-256、更新内容与来源
- 写入 REPLACED 事件（审计）
- 响应中 created_at 沿用首次创建时间、updated_at 更新

**路径参数**：type、id（必填）。文档不存在 → 200 + 40401。

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| content | JSON | 是 | 新内容（任意合法 JSON，非法 → 40001） |
| source_ref | string | 否 | 新来源引用 |
| actor | string | 否 | 操作主体 |
| reason | string | 否 | 更新原因 |

**示例**：

```json
// 请求
PUT /api/documents/VEHICLE_PROFILES/agv-standard
{"content": {"maxSpeed": 2.0, "width": 0.8}, "actor": "李四", "reason": "提速升级"}

// 响应（revision 递增）
HTTP 200
{"code": 0, "message": "ok", "data": {"revision": 4, "content": {...新内容...}, "content_sha256": "新摘要"}}
```

---

## 5. 开批导入（迁移）

`POST /api/migrations`

**作用**：把历史数据从旧系统批量导入（一次一批，migration_id 幂等），并留完整台账供对账与回滚。

**效果**：
- 服务端对清单整体计算 manifest_sha256 并写入 run 表（批次封面：谁、什么时候、按什么清单导的）
- 逐条三路分支（同事务）：
  - 目标不存在 → 新建文档 revision=1 + MIGRATED 事件 + item(INSERTED, imported_revision=1)
  - 内容哈希与目标相同 → item(SKIPPED_SAME)，不碰业务表（**同清单重跑安全**）
  - 内容不同 → 替换 revision+1 + MIGRATED 事件 + item(INSERTED, imported_revision=新值)（迁移语义：新系统数据以清单为准）
- **幂等**：migration_id 已存在 → 40901「迁移批次已存在」，同批重跑需先回滚

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| migration_id | string | 是 | 批号（幂等键，≤128） |
| actor | string | 是 | 执行主体（审计，≤255） |
| items | array | 是 | 清单（至少 1 条；批内 (type,id) 不允许重复） |
| items[].document_type | string | 是 | 目标文档类别（≤64） |
| items[].document_id | string | 是 | 目标文档 ID（≤255） |
| items[].source_ref | string | 否 | 旧系统来源引用（≤2048） |
| items[].content | string | 是 | 文档内容（JSON 文本） |
| items[].content_sha256 | string | 是 | 内容指纹（十六进制 64 字符；服务端重算校验，不一致 40001） |

**响应 data**：`{migration_id, inserted, skipped}`——统计结果（含替换的计入 inserted）。

**错误场景**：

| 场景 | 响应 |
|---|---|
| migration_id 已存在 | 200 + 40901「迁移批次已存在」 |
| 清单内 (type,id) 重复 | 200 + 40001 |
| 内容哈希与 content 不一致 | 200 + 40001 |
| 清单为空 / 必填缺失 | 200 + 40001 |

**示例**：

```json
// 请求
POST /api/migrations
{"migration_id": "MIG-20260905-001", "actor": "chenpeng", "items": [
  {"document_type": "VEHICLE_PROFILES", "document_id": "agv-01",
   "source_ref": "legacy/profiles/agv-01.json",
   "content": "{\"maxSpeed\": 2.0}", "content_sha256": "abc123...64位"}
]}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "migration_id": "MIG-20260905-001", "inserted": 1, "skipped": 0
}}
```

---

## 6. 迁移批次列表

`GET /api/migrations`

**作用**：查询迁移批次台账（run 表），按应用时间倒序。

**效果**：纯查询，无副作用。

**查询参数**：limit（<=0 或 >1000 取默认 100）、page（从 1 起；0 视为 1，负数 40001）。

**响应 data**：`{total, items}`。单条 run 字段：migration_id、applied_at、rolled_back_at（可空：没回滚不出现）、actor、manifest_sha256。

---

## 7. 迁移批次详情

`GET /api/migrations/:id`

**作用**：按批号查询 run + 全部 item（明细台账），还原「这批导了什么、各条发生了什么」。

**效果**：纯查询，无副作用。批次不存在 → 200 + 40401。

**响应 data**：`{run, items}`。单条 item 字段：

| 字段 | 说明 |
|---|---|
| document_type / document_id | 目标文档 |
| source_ref | 旧系统来源引用 |
| content_sha256 | 内容指纹 |
| imported_revision | 导入生成的修订号（SKIPPED_SAME 为 0，响应中不出现） |
| action | INSERTED（插入/替换）/ SKIPPED_SAME（内容相同跳过） |
| rolled_back_at | 回滚时间（可空：仅 INSERTED 条目回滚后出现） |

---

## 8. 回滚迁移批次

`POST /api/migrations/:id/rollback`

**作用**：整批退回该批 INSERTED 的条目（批次级，不支持部分回滚），台账盖时间戳留痕。

**效果**：
- 删除该批 INSERTED 条目对应的当前文档行（删除前先清该文档的全部事件——事件表外键指向文档行，先删文档会导致外键校验失败）
- 仅 INSERTED 的 item 盖 rolled_back_at（SKIPPED_SAME 当时未写业务表，无动作不盖）；run 盖 rolled_back_at
- 台账只标记不删行：一年后仍可查「这批导入过、后来被回滚」；批次级审计由 run/item 台账保留（文档级事件随文档回退，actor 暂不落库）

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
POST /api/migrations/MIG-20260905-001/rollback
{"actor": "chenpeng"}

HTTP 200
{"code": 0, "message": "ok"}
```

---

## 附：版本链与追溯

- 每次更新 revision+1，历史版本不覆盖（事件表 rcs_control_plane_document_event 按 (type, id, revision) 全量留痕）
- content_sha256 保证内容完整性（下发车辆前可验真）
- **迁移台账（run + item）**：run 是批次封面（谁/何时/清单指纹），item 是每条明细（来源/指纹/实际动作/导入修订号）；回滚时间戳只盖 INSERTED 条目，语义精确对应「这条到底有没有被退回」
- 各领域的专项业务（绑定状态机、FAT 发布流程、审批流）待对应阶段实现；迁移台账中 **control_plane 组**（`/api/migrations`）与 **audit 组**（`/api/audit-migrations`）均已实现、接口可用，**task_snapshot 组**已建表、接口待对应阶段实现
