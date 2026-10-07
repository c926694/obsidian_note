# RCS 机器人管理域接口文档（agv）

> 服务链路：前端 → gateway-api（HTTP，:8110）→ rcs-agv（gRPC，:9094）→ PostgreSQL（127.0.0.1:5433/vda5050_rcs，与其他服务共用）
> 契约源头：`gateway-api/agvapi/agv.api`（HTTP 层）、`rpc/agv/agv.proto`（rpc 层）
> 业务来源：SFMS 两张表（机器人类型页/机器人配置页）的 Go 重构（表名前缀由 sfms_ 改为 rcs_：rcs_device / rcs_agv_equipment_management），
> 契约按 RCS 统一规范（不沿用 Java 的 /SFMS 路径与 ResultWrapper 信封）。

## 通用约定

- **响应信封**：所有接口统一返回 `{code, message, data}`，`code=0` 表示成功
- **分页约定**：列表接口传 `limit`（每页条数）+ `page`（页码，从 1 起；0 视为 1，负数 40001），响应 data 为 `{total, items}` 标准分页结构；limit<=0 或 >1000 取默认 100。**例外**：`GET /api/devices/all` 不分页——无 limit/page、响应不含 total、元素为精简三字段（见第 3 节）
- **可空字段**：空字符串/0 表示 NULL（未设置的字段在响应中不出现）
- **错误码**：

| code | HTTP 状态 | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 40001 | 200 | 参数错误（必填缺失、超长、非法取值） |
| 40401 | 200 | 记录不存在 |
| 40901 | 200 | 冲突（设备编号或状态字典 id 已存在） |
| 50001 | 500 | 服务器内部错误 |

## 接口总览

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/devices | 创建设备类型 |
| GET | /api/devices | 设备类型列表（分页 + 过滤） |
| GET | /api/devices/all | 设备类型全量列表（不分页、无 total，下拉框用） |
| GET | /api/devices/:id | 设备类型详情 |
| PUT | /api/devices/:id | 更新设备类型（整体覆盖） |
| DELETE | /api/devices/:id | 删除设备类型 |
| POST | /api/agvs | 创建设备配置 |
| GET | /api/agvs | 设备配置列表（分页 + 过滤） |
| GET | /api/agvs/:code | 设备配置详情 |
| PUT | /api/agvs/:code | 更新设备配置（整体覆盖） |
| DELETE | /api/agvs/:code | 删除设备配置 |
| POST | /api/equipment-statuses | 创建设备状态字典（id 由调用方传入） |
| GET | /api/equipment-statuses | 设备状态字典列表（分页 + 过滤） |
| GET | /api/equipment-statuses/:id | 设备状态字典详情 |
| PUT | /api/equipment-statuses/:id | 更新设备状态字典（整体覆盖） |
| DELETE | /api/equipment-statuses/:id | 删除设备状态字典 |

---

## 1. 创建设备类型

`POST /api/devices`

**作用**：创建一个设备类型（rcs_device 表，机器人类型页新增）。

**效果**：
- 服务端生成自增主键 id 并随响应返回
- size_x、size_y 都传时自动计算旋转直径（斜边 sqrt(x²+y²)，mm，保留 2 位小数）随响应返回，调用方无需传
- 无幂等设计：重复提交会创建多条记录（与 Java 行为一致）

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| device_type | string | 是 | 设备大类（如 AGV/ROBOT），最长 50 字符 |
| equipment_type | string | 否 | 设备子类型（如 SMALL_AGV），最长 50 字符 |
| size_x | int | 否 | 尺寸-长（X，mm），0 视为未设置 |
| size_y | int | 否 | 尺寸-宽（Y，mm） |
| size_z | int | 否 | 尺寸-高（Z，mm） |
| brand | string | 否 | 品牌，最长 64 字符 |

**响应 data**：DeviceInfo（8 字段，见「设备类型详情」一节，rotation_diameter 为只读计算值）。

**示例**：

```json
// 请求
POST /api/devices
{"device_type": "AMR", "equipment_type": "SMALL_AGV",
  "size_x": 1200, "size_y": 800, "size_z": 900, "brand": "海康"}

// 响应（rotation_diameter 由 size_x、size_y 自动算出：sqrt(1200²+800²)=1442.22）
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 2122, "device_type": "AMR", "equipment_type": "SMALL_AGV",
    "size_x": 1200, "size_y": 800, "size_z": 900, "rotation_diameter": 1442.22, "brand": "海康"
}}
```

---

## 2. 设备类型列表

`GET /api/devices`

**作用**：查询设备类型列表，支持按大类/子类型过滤与分页。

**效果**：纯查询，无副作用。按 id 倒序（最新在前）。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| device_type | string | 否 | 按设备大类精确过滤；空 = 不过滤 |
| equipment_type | string | 否 | 按设备子类型精确过滤；空 = 不过滤 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`——total 为满足过滤条件的总条数，items 为 DeviceInfo 数组。

**示例**：

```json
GET /api/devices?device_type=AMR&limit=10&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 3,
  "items": [
    {"id": 2122, "device_type": "AMR", "equipment_type": "SMALL_AGV"},
    {"id": 2119, "device_type": "AMR", "equipment_type": "FORK_AGV"}
  ]
}}
```

---

## 3. 设备类型全量列表（不分页）

`GET /api/devices/all`

**作用**：一次返回全部设备类型，给前端下拉框/选择器用——要全量、不要分页，也不需要总数。

**效果**：纯查询，无副作用。按 id 倒序（最新在前）。**不返回 total**；元素只下发 id、device_type、equipment_type 三个字段（尺寸、旋转直径、品牌不下发）。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| device_type | string | 否 | 按设备大类精确过滤；空 = 不过滤 |
| equipment_type | string | 否 | 按设备子类型精确过滤；空 = 不过滤 |

> **没有 limit / page**：本接口不分页，这两个参数传了会被忽略（不报错）。需要分页与总数请用 `GET /api/devices`（第 2 节）。

**响应 data**：`{devices}`——devices 是精简元素数组；**三个字段恒定出现**，库里 equipment_type 为 NULL 时返回空串（前端不必判 undefined，直接当字符串用）。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 设备主键 ID |
| device_type | string | 设备大类 |
| equipment_type | string | 设备子类型（库中为 NULL 时为空串） |

**示例**：

```json
GET /api/devices/all?device_type=FMR

HTTP 200
{"code": 0, "message": "ok", "data": {
  "devices": [
    {"id": 7, "device_type": "FMR", "equipment_type": "FMR_100"},
    {"id": 3, "device_type": "FMR", "equipment_type": "FMR_100"}
  ]
}}

// 无匹配时 data.devices 是空数组（不是 null）
HTTP 200
{"code": 0, "message": "ok", "data": {"devices": []}}
```

**与「设备类型列表」的取舍**：

| 维度 | GET /api/devices（第 2 节） | GET /api/devices/all（本节） |
|---|---|---|
| 分页 | 有：limit/page，默认 100 条、上限 1000 | 无：一次返回全部 |
| 总数 | data.total | 不返回 |
| 元素字段 | DeviceInfo 全 8 个字段 | 精简 3 个字段 |
| 典型用途 | 机器人类型页表格（要分页与总数） | 下拉框/选择器（要全量、不要总数） |

---

## 4. 设备类型详情

`GET /api/devices/:id`

**作用**：按主键 id 查询设备类型。

**效果**：纯查询，无副作用。

**路径参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | int | 是 | 设备主键 ID（创建时服务端返回） |

**响应 data**：DeviceInfo。不存在 → 200 + 40401。

**DeviceInfo 字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 设备主键 ID（自增） |
| device_type | string | 设备大类 |
| equipment_type | string | 设备子类型（可空） |
| size_x | int | 尺寸-长（X，mm，可空） |
| size_y | int | 尺寸-宽（Y，mm，可空） |
| size_z | int | 尺寸-高（Z，mm，可空） |
| rotation_diameter | number | 旋转直径（mm，由 size_x、size_y 自动计算 sqrt(x²+y²)，只读，请求不接收） |
| brand | string | 品牌（可空） |

**示例**：

```json
GET /api/devices/2122

HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 2122, "device_type": "AMR", "equipment_type": "SMALL_AGV",
    "size_x": 1200, "size_y": 800, "size_z": 900, "rotation_diameter": 1442.22, "brand": "海康"
}}
```

---

## 5. 更新设备类型

`PUT /api/devices/:id`

**作用**：整体覆盖更新设备类型（device_type + equipment_type 全量替换）。

**效果**：
- 更新传入的全部字段（未传 equipment_type 则覆盖为空）
- **传与库中完全相同的值也算成功**（返回 code 0；只有目标不存在才 40401）

**路径参数**：id（必填，主键）

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| device_type | string | 是 | 设备大类（最长 50 字符） |
| equipment_type | string | 否 | 设备子类型（最长 50 字符） |
| size_x | int | 否 | 尺寸-长（X，mm；与 Y 一起传入后自动重算 rotation_diameter） |
| size_y | int | 否 | 尺寸-宽（Y，mm） |
| size_z | int | 否 | 尺寸-高（Z，mm） |
| brand | string | 否 | 品牌（最长 64 字符） |

**错误场景**：

| 场景 | 响应 |
|---|---|
| 设备类型不存在 | 200 + 40401 |
| 必填缺失 / 超长 / 尺寸格式非法 | 200 + 40001 |

**示例**：

```json
// 请求
PUT /api/devices/2122
{"device_type": "AMR", "equipment_type": "FORK_AGV",
 "size_x": 1000, "size_y": 1000, "size_z": 500}

// 响应（rotation_diameter 重算：sqrt(1000²+1000²)=1414.21）
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 2122, "device_type": "AMR", "equipment_type": "FORK_AGV",
  "size_x": 1000, "size_y": 1000, "size_z": 500, "rotation_diameter": 1414.21
}}
```

---

## 6. 删除设备类型

`DELETE /api/devices/:id`

**作用**：按主键删除设备类型。

**效果**：物理删除（无软删/回收站）。不存在 → 200 + 40401。

**路径参数**：id（必填，主键）

**示例**：

```json
DELETE /api/devices/2122

HTTP 200
{"code": 0, "message": "ok"}
```

---

## 7. 创建设备配置

`POST /api/agvs`

**作用**：创建一个设备配置（rcs_agv_equipment_management 表，机器人配置页新增；只存静态信息）。

**效果**：
- agv_code 为业务键（唯一）：已存在返回 40901「设备编号 xxx 已存在」，不覆盖
- map_code 非空时校验地图存在（不存在 → 40001）
- 可空字段不传则入库 NULL

**请求体**：

| 字段             | 类型     | 必填  | 说明                        |
| -------------- | ------ | --- | ------------------------- |
| agv_code       | string | 是   | 设备编号（业务键，唯一），最长 64        |
| equipment_name | string | 否   | 设备名称（≤100）                |
| equipment_type | string | 否   | 设备类型（≤64）                 |
| map_code       | string | 否   | 所属地图编码（≤50，**非空时校验地图存在**） |

**响应 data**：AgvInfo（见第 9 节）。

**示例**：

```json
// 请求
POST /api/agvs
{"agv_code": "AGV-005", "equipment_name": "1号叉车", "equipment_type": "FORK_AGV", "map_code": "MAP-DEMO"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 7, "agv_code": "AGV-005", "equipment_name": "1号叉车",
  "equipment_type": "FORK_AGV", "map_code": "MAP-DEMO"
}}

// 响应（agv_code 已存在）
HTTP 200
{"code": 40901, "message": "设备编号 AGV-005 已存在"}
```

---

## 8. 设备配置列表

`GET /api/agvs`

**作用**：查询设备配置列表，支持按设备类型/地图过滤与分页。

**效果**：纯查询，无副作用。按 agv_code 升序。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| equipment_type | string | 否 | 按设备类型精确过滤；空 = 不过滤 |
| map_code | string | 否 | 按所属地图精确过滤；空 = 不过滤 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`，items 为 AgvInfo 数组。

**示例**：

```json
GET /api/agvs?equipment_type=SMALL_AGV&limit=10&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 2,
  "items": [
    {"agv_code": "AGV-001", "equipment_type": "SMALL_AGV",
     "equipment_name": "1号叉车", "equipment_type": "FORK_AGV", "map_code": "MAP-DEMO"}
  ]
}}
```

---

## 9. 设备配置详情

`GET /api/agvs/:code`

**作用**：按设备编号 agv_code 查询设备配置。

**效果**：纯查询，无副作用。

**路径参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | string | 是 | 设备编号（业务键，唯一；仅作定位，不可改） |

**响应 data**：AgvInfo。不存在 → 200 + 40401。

**AgvInfo 字段说明**（5 个业务字段）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 ID（自增，服务端生成） |
| agv_code | string | 设备编号（业务键，唯一） |
| equipment_name | string | 设备名称（可空） |
| equipment_type | string | 设备类型（可空） |
| map_code | string | 所属地图编码（可空） |

**示例**：

```json
GET /api/agvs/AGV-001

HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 1, "agv_code": "AGV-001", "equipment_name": "1号叉车",
  "equipment_type": "FORK_AGV", "map_code": "MAP-DEMO"
}}
```

---

## 10. 更新设备配置

`PUT /api/agvs/:code`

**作用**：整体覆盖更新设备配置（equipment_name / equipment_type / map_code 全量替换，agv_code 不可改）。

**效果**：
- 更新传入的字段；未传的可空字段会被覆盖为 NULL（与创建语义一致：空串表示未设置）
- map_code 非空时校验地图存在（不存在 → 40001）
- **传与库中完全相同的值也算成功**（返回 code 0；只有目标不存在才 40401）
- 无 version 乐观锁（低频人工 CRUD、整体覆盖语义）

**路径参数**：code（必填，设备编号）

**请求体**：`equipment_name` / `equipment_type` / `map_code`（与创建相同，见第 7 节表格）。

**错误场景**：

| 场景 | 响应 |
|---|---|
| 设备配置不存在 | 200 + 40401 |
| 必填缺失 / 超长 | 200 + 40001 |

**示例**：

```json
PUT /api/agvs/AGV-005
{"equipment_name": "1号叉车（改名）", "equipment_type": "FORK_AGV", "map_code": "MAP-DEMO"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 7, "agv_code": "AGV-005", "equipment_name": "1号叉车（改名）",
  "equipment_type": "FORK_AGV", "map_code": "MAP-DEMO"
}}
```

---

## 11. 删除设备配置

`DELETE /api/agvs/:code`

**作用**：按设备编号删除设备配置。

**效果**：物理删除（无软删/回收站）。不存在 → 200 + 40401。

**路径参数**：code（必填，设备编号）

**示例**：

```json
DELETE /api/agvs/AGV-005

HTTP 200
{"code": 0, "message": "ok"}
```

---

## 12. 创建设备状态字典

`POST /api/equipment-statuses`

**作用**：新增一条设备状态字典（rcs_agv_equipment_status 表）——状态码 ↔ 中文描述的对照表。

**效果**：
- **主键 id 由调用方传入**（照 Java `IdType.INPUT` 契约）：已存在返回 40901「状态字典 id xxx 已存在」，不覆盖
- equipment_type 必填（NOT NULL 列）；equipment_status / equipment_status_description 可空
- 状态码**不做枚举校验**（存量数据字面量不统一，见附）

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | int | 是 | 字典主键 ID（**调用方传入**，≥1） |
| equipment_status | string | 否 | 设备状态码（≤64） |
| equipment_status_description | string | 否 | 状态描述（≤64） |
| equipment_type | string | 是 | 设备类型（≤64，NOT NULL） |

**响应 data**：EquipmentStatusInfo（见第 14 节）。

**示例**：

```json
// 请求
POST /api/equipment-statuses
{"id": 1001, "equipment_status": "RUNNING", "equipment_status_description": "运行中", "equipment_type": "AGV"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 1001, "equipment_status": "RUNNING",
  "equipment_status_description": "运行中", "equipment_type": "AGV"
}}

// 响应（id 已存在）
HTTP 200
{"code": 40901, "message": "状态字典 id 1001 已存在"}
```

---

## 13. 设备状态字典列表

`GET /api/equipment-statuses`

**作用**：查询状态字典，支持按状态码/设备类型过滤与分页。

**效果**：纯查询，无副作用。按 id 升序。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| equipment_status | string | 否 | 按状态码精确过滤；空 = 不过滤 |
| equipment_type | string | 否 | 按设备类型精确过滤；空 = 不过滤 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`，items 为 EquipmentStatusInfo 数组。

**示例**：

```json
GET /api/equipment-statuses?equipment_type=AGV&limit=10&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 2,
  "items": [
    {"id": 1001, "equipment_status": "RUNNING",
     "equipment_status_description": "运行中", "equipment_type": "AGV"}
  ]
}}
```

---

## 14. 设备状态字典详情

`GET /api/equipment-statuses/:id`

**作用**：按主键 id 查询字典条目。

**效果**：纯查询，无副作用。

**路径参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | int | 是 | 字典主键 ID（仅作定位，不可改） |

**响应 data**：EquipmentStatusInfo。不存在 → 200 + 40401。

**EquipmentStatusInfo 字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 ID（**调用方传入**，非自增） |
| equipment_status | string | 设备状态码（可空，未设置不出现） |
| equipment_status_description | string | 状态描述（可空，未设置不出现） |
| equipment_type | string | 设备类型（必填列，始终出现） |

**示例**：

```json
GET /api/equipment-statuses/1001

HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 1001, "equipment_status": "RUNNING",
  "equipment_status_description": "运行中", "equipment_type": "AGV"
}}
```

---

## 15. 更新设备状态字典

`PUT /api/equipment-statuses/:id`

**作用**：整体覆盖更新字典条目（equipment_status / equipment_status_description / equipment_type 全量替换，id 不可改）。

**效果**：
- 存在性前置检查：目标不存在 → 200 + 40401；**相同值更新按成功处理**
- 可空字段传空串即覆盖为 NULL

**路径参数**：id（必填）

**请求体**：同第 12 节（**不含 id**，id 走路径）。

**响应 data**：更新后的 EquipmentStatusInfo。

**示例**：

```json
// 请求
PUT /api/equipment-statuses/1001
{"equipment_status": "IDLE", "equipment_status_description": "空闲待命", "equipment_type": "AGV"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 1001, "equipment_status": "IDLE",
  "equipment_status_description": "空闲待命", "equipment_type": "AGV"
}}
```

---

## 16. 删除设备状态字典

`DELETE /api/equipment-statuses/:id`

**作用**：按主键 id 删除字典条目。

**效果**：物理删除（无软删/回收站）。不存在 → 200 + 40401。

**路径参数**：id（必填）

**示例**：

```json
DELETE /api/equipment-statuses/1001

HTTP 200
{"code": 0, "message": "ok"}
```

---

## 附：设计说明

- **无 version 乐观锁**：设备 CRUD 是低频人工操作、整体覆盖语义、无状态机，无并发裁决需求
- **状态类字段字符串透传**：equipment_status/status 不做枚举校验——历史存量数据字面量不统一（'3'/'IDLE'/'error' 并存），枚举收敛属业务待办
- **状态字典主键由调用方传入**：rcs_agv_equipment_status 的 id 不自增（照 Java `IdType.INPUT` 契约），id 的业务含义由上位系统给定，服务端只做存在性与冲突校验
- **过滤为精确匹配**（RCS 规范），与 SFMS 原版的 LIKE 模糊不同；翻译（如 equipment_type 码→中文名）由前端映射，后端只存原始值
- **相同值更新算成功**：RowsAffected 只统计「实际改变的行数」（PG 同语义），实现上以「前置存在性检查」判定 404，与受影响行数解耦
- **为什么单开一个全量接口**：前端下拉框要「拿全部、不要总数」，塞进 `GET /api/devices` 会让同一路径出现两种响应形态（`{total, items}` 与 `{devices}`）且要靠「有没有传分页参数」分流；单开 `GET /api/devices/all` 后老接口行为完全不变（不传分页参数仍是第 1 页最多 100 条），两条链路在 rpc 层复用同一段查询、只差一个 LIMIT
- 建表：`common/db/migrations/003_rcs_agv_tables.sql`（迁移器在服务启动时自动执行）
