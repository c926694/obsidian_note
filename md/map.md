# 地图域接口文档（rcs-map）

> 服务链路：前端 → gateway-api（HTTP，:8110）→ rcs-map（gRPC，:9095）→ PostgreSQL / Redis
> 接口定义源头：`gateway-api/mapapi/map.api` 与 `gateway-api/mapapi/handler/routes.go`（HTTP 层）、`rpc/mapx/mapx.proto`（rpc 层，service Mapx 共 65 个 rpc）
> 业务对象：地图配置（rcs_map_config）+ 点线拓扑（rcs_map_point / rcs_map_line，线即边）+ 图内区域（rcs_map_zone / rcs_map_zone_line）+ 避障方案字典（rcs_map_avoidance_plan）+ 快照版本（rcs_map_config_version），点线与区域以地图编号 map_code 挂靠。
> 两条数据链路：**前端编辑器**走快照 JSON 文件（保存时把提交的 JSON 原文按版本写盘、加载时读 url 取回整图）；**调度侧**消费点线表与区域表的结构化数据，经 `GET /api/maps/:id/graph` 一次取全图。

## 通用约定

- **响应信封**：所有接口统一返回 `{code, message, data}`，`code=0` 表示成功
- **分页约定**：列表接口传 `limit`（每页条数）+ `page`（页码，从 1 起；0 视为 1，负数 40001），响应 data 为 `{total, items}` 标准分页结构；`limit<=0` 或 `>1000` 取默认 100
- **可空字段**：空字符串表示 NULL（创建后未填写的字段在响应中不出现）
- **时间格式**：RFC3339Nano 字符串（`updated_at` 由后端维护：创建取当前时间，更新元信息或保存拓扑时刷新）
- **URL 格式**：快照 url 为**对外相对路径**（`/static/maps/xxx_v{n}.json`），前端用自己的后端地址拼完整 URL 下载；后端不感知 IP 与端口，静态快照响应带跨域头
- **快照版本**：version 由后端自管，前端不传也不需要用；首次保存 0→1，之后每次 +1，只保留最近 10 份（超出部分保存时裁剪）
- **品牌参数**：拓扑地图本身不带品牌（`rcs_map_config` 没有品牌列），需要品牌的接口一律由调用方显式给出：导入用本次原件的品牌、导出与下发用目标品牌、重算与品牌字段面板用用户所选品牌。`brand` 取 `SEER`（仙工）/ `HIK`（海康）/ `HUARUI`（华睿）；`rcs_map_config.brand_map_codes` 单独记录该图在各品牌系统里的图名
- **gRPC 消息上限**：走 gRPC 返回的整图全文（RoboRoute XML、自研 XML/JSON、smap）受单条消息默认 4MB 上限约束；上传类文件（导航地图、smap、品牌包）一律由网关写成临时文件、只把文件名交给 rpc
- **错误码**：

| code | HTTP 状态 | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 40001 | 200 | 参数错误（必填缺失、JSON 非法、uuid 格式非法、角度超 0-360、速度为负、线端点不在提交点集内、点编号在提交集合内重复、避障方案 id 不存在、区域类型非法、区域关联线不在提交线集内） |
| 40401 | 200 | 地图、导航地图、地图元素或避障方案不存在 |
| 40901 | 200 | 冲突（地图编号或名称已存在、避障方案编号已存在、删除避障方案时仍被线引用、点或线 uuid 被其他地图占用、同一对起终点边数超过 8 条、地图被他人编辑锁定、导航地图编号或关联地图编号已被占用、地图元素 code 重复、业务属性字段 (scope, code) 重复） |
| 50001 | 500 | 服务器内部错误 |
| 50301 | 200 | 依赖服务不可用（FMS 站点接口未配置或不可达，绑定站点时未带 force） |

## 拓扑数据规则（点线表）

**点（rcs_map_point）**：点编号 `point_code` 在本图内唯一（提交集合内重复 → 40001），且**在整个点位库里跨图唯一**（被其他图占用 → 40001，因为任务只带点编号，同编号出现在两张图上会让车开向另一个物理位置）；点 uuid 全局唯一（被其他地图占用 → 40901）；坐标为整数毫米，允许为负。

**点位编码规范化**：CAD 导出的点位编码常常就是坐标（形如 `000604,000282`），这类「数字,数字」编码在保存拓扑与绑定站点时自动改写成 `X000604Y000282`，原名写进 `rcs_map_point_alias` 留档（`alias_source` 区分 `topology` 与 `bind`）；含逗号但不是数字对形态的编码原样保留、需人工改名，同步体检会把它报成 `POINT_CODE_ILLEGAL`。规范化后与既有编码撞车 → 40001。

**线（rcs_map_line，线即边）**：方向语义恒为 `start_point_uuid → end_point_uuid`；`one_way=false`（默认）表示双向可走、可逆行，`true` 表示只能按该方向通行；起终点必须引用本次提交点集内的点 id（否则 40001）；**同一对起终点最多 8 条边，线型与弯曲方向不限**（超过 8 条 → 40901）；线引用的避障方案必须存在（否则 40001）；角度族 `angle` / `in_angle` / `out_angle` 取值 0-360 整数、0 或 NULL 表示未设置（超出 → 40001），坐标系为 Y 向上、0°=X 向右、90°=Y 向上、逆时针为正；`speed=0` 表示不限制（写入 NULL）。

**点位方向与显示尺寸**：`direction` 是车到该点后车头要正对的朝向（度、0-360、与线的角度同坐标系），NULL 表示未配置（下发 order 时该点朝向沿用行进方向），0 是有效值；`size_mm` 是画布上的图标显示尺寸（毫米，纯显示参数，车端与调度不读）。

**保存语义（`PUT /api/maps/:id/topology`）**：按主键增删改——ID 在的行只更新画布提交的列，ID 不在的行插入，提交里没有的点线删除（单事务，失败整体回滚）。不随画布提交的列（站点绑定 `station_code`、品牌原始属性 `brand_raw`、站点类型与高度、单双向之外的品牌字段）在 ID 不变时保持库内值；提交空数组即清空该图点线。区域仅在本次提交带 `zones` 键时整包替换。

## 接口总览

### 地图配置与快照

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/maps | 创建地图配置 |
| GET | /api/maps | 地图配置列表（分页 + 过滤） |
| GET | /api/maps/:id | 地图配置详情 |
| PUT | /api/maps/:id | 更新地图配置（整体覆盖 + 品牌编号映射整体覆盖） |
| DELETE | /api/maps/:id | 删除地图配置（级联清点线、区域、版本记录、导航地图、留档表与磁盘文件） |
| GET | /api/maps/:id/versions | 快照版本列表（倒序，最新在前） |
| POST | /api/maps/:id/rollback | 回滚到指定版本（只返回该版本快照地址，不改任何状态） |
| POST | /api/maps/:id/lock | 取地图编辑锁（进入编辑页） |
| POST | /api/maps/:id/lock/heartbeat | 编辑锁续期（编辑中每 2 分钟一次） |
| DELETE | /api/maps/:id/lock | 释放编辑锁（退出编辑） |

### 拓扑与区域

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/:id/topology | 快照地址查询（前端加载画布用，返回相对路径） |
| PUT | /api/maps/:id/topology | 整图保存（提交 JSON：解析点线入库 + 区域入库 + 快照写盘 + 生成 url） |
| GET | /api/maps/:id/graph | 整图结构化数据（点全量 + 线全量含角度族/单双向/所属区域 + 区域全量，供调度内核建图） |

### 导出与导入

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/:id/robot-route | 取 RoboRoute XML 导出地址（JSON 信封，只回 url） |
| GET | /api/maps/:id/robot-route/file | RoboRoute XML 下载口（附件形式，现场生成不写磁盘） |
| GET | /api/maps/:id/self-xml/file | 自研格式 XML 下载口（整图全量） |
| GET | /api/maps/:id/self-json/file | 自研格式 JSON 下载口（同一份整图数据） |
| GET | /api/maps/:id/smap/export | 取 smap 导出统计与可用性提示（同时起校验作用） |
| GET | /api/maps/:id/smap/file | smap 下载口（.smap 附件，现场生成不写磁盘） |
| GET | /api/maps/:id/smap/source | 取导出 smap 的原料（留档元素原文 + 导入记录 + 2D 栅格原文） |
| POST | /api/maps/:id/smap/import | 导入仙工 .smap（一次导入产出拓扑与导航两套结果） |
| GET | /api/maps/:id/package/source | 取导出品牌地图包的原料（品牌桶原文 + vendor 留档 + 元素编号映射） |
| POST | /api/maps/:id/import-package | 导入品牌地图包（multipart，多文件或单个 zip；brand 手选） |
| POST | /api/maps/:id/laser/smap | 把 smap 的 2D 点云存成该图的激光层 |

### 导航地图

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/nav-maps | 新建导航地图（multipart 上传文件） |
| GET | /api/nav-maps | 导航地图列表（分页 + 过滤） |
| GET | /api/nav-maps/:id | 导航地图详情 |
| PUT | /api/nav-maps/:id/file | 换文件（版本号自增，保留最近 10 版） |
| DELETE | /api/nav-maps/:id | 删除导航地图（含全部版本文件） |
| GET | /api/nav-maps/:id/versions | 版本列表（倒序） |
| POST | /api/nav-maps/:id/rollback | 回滚到指定版本（只返回该版本文件地址） |

### 避障方案

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/avoidance-plans | 创建避障方案 |
| GET | /api/avoidance-plans | 避障方案列表（分页 + 编号模糊过滤） |
| GET | /api/avoidance-plans/:id | 避障方案详情 |
| PUT | /api/avoidance-plans/:id | 更新避障方案 |
| DELETE | /api/avoidance-plans/:id | 删除避障方案（仍被线引用时拒绝） |

### 点位与站点归属

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/:map_code/points | 点位清单（含站点绑定与业务字段） |
| PUT | /api/maps/:map_code/points/:point_code/station | 绑定 FMS 站点 |
| DELETE | /api/maps/:map_code/points/:point_code/station | 解绑站点 |
| PUT | /api/maps/:map_code/points/:point_code/detour | 设置点位「可避让绕路」开关 |
| GET | /api/maps/:map_code/points/sync-check | 单图同步体检（四类差异 + 两个参考块） |
| GET | /api/maps/stations/sync-check | 站点归属跨图体检（已有地图 / 还没有地图 / 悬空绑定） |
| POST | /api/maps/:map_code/points/rerank | 按品牌整图重算点位语义类型 |

### 地图元素与语义

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/map-elements | 地图元素列表（brand/code 过滤） |
| POST | /api/maps/map-elements | 新增地图元素 |
| GET | /api/maps/map-elements/:id | 地图元素详情 |
| PUT | /api/maps/map-elements/:id | 修改地图元素（整体覆盖） |
| DELETE | /api/maps/map-elements/:id | 删除地图元素 |
| GET | /api/maps/map-elements/semantic-types | 语义类型候选值清单 + 自研属性字段清单 |
| GET | /api/maps/map-elements/icons | 内置图例清单 |
| GET | /api/maps/map-elements/icons/:code | 取单个图例 |

### 品牌字段与业务属性

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/map-field-dict | 品牌字段字典（按 brand/scope 过滤） |
| PUT | /api/maps/map-field-dict/:id | 人工维护字段（标签/分组/枚举/排序/可编辑/备注/自研属性关联） |
| GET | /api/maps/:map_code/points/:point_code/brand-fields | 取点位品牌字段 |
| PUT | /api/maps/:map_code/points/:point_code/brand-fields | 写回点位品牌字段 |
| GET | /api/maps/:map_code/lines/:line_id/brand-fields | 取线段品牌字段 |
| PUT | /api/maps/:map_code/lines/:line_id/brand-fields | 写回线段品牌字段 |
| GET | /api/maps/map-self-fields | 自研业务属性字段清单 |
| POST | /api/maps/map-self-fields | 新增业务属性字段 |
| PUT | /api/maps/map-self-fields/:id | 修改业务属性字段 |
| DELETE | /api/maps/map-self-fields/:id | 删除业务属性字段 |

### 激光层、地图包与下发

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/:id/laser | 激光层元信息（顺带渲染该级别底图） |
| GET | /api/maps/:id/laser/points | 激光点云原文（前端自己渲染底图） |
| PUT | /api/maps/:id/laser/offset | 保存激光底图的平移与旋转参数（平移 + 旋转） |
| POST | /api/maps/:id/generate-package | 按品牌生成可下发的地图包 |
| GET | /api/maps/:id/packages | 地图包当前版与版本台账 |
| POST | /api/maps/:id/deploy | 把当前版地图包推给车体或厂商平台 |

### rpc 层不对外暴露的接口

| rpc 方法 | 用途 |
|---|---|
| ExistsMapCode | 地图编号存在性校验（机器人管理服务建设备/改设备时校验 map_code 引用） |
| MissingPointCodes | 点位编码批量存在性校验（编排服务存场景模板时校验点位引用；任意地图存在即算存在） |

## 1. 创建地图配置

`POST /api/maps`

**作用**：创建一个地图配置（rcs_map_config 表，地图配置页新增）。

**效果**：
- 服务端生成自增主键 id 并随响应返回
- map_code（地图编号）/map_name（地图名称）必填且唯一：任一重复返回 200 + 40901
- brand_map_codes 可选，同一品牌最多一条（重复 → 40001，中文说明「同一品牌只能配一条」）；不传即空数组
- 无幂等设计：重复提交会创建多条记录

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| map_code | string | 是 | 地图编号（业务键，唯一），最长 50 字符 |
| map_name | string | 是 | 地图名称（唯一），最长 100 字符 |
| floor_code | string | 是 | 所属楼层编码，最长 50 字符 |
| brand_map_codes | array | 否 | 第三方品牌地图编号映射，元素为 `{brand, map_code}`；建图时一般还没有，随地图编辑补配 |

**响应 data**：MapConfigInfo（见「地图配置详情」一节）。

**示例**：

```json
// 请求
POST /api/maps
{"map_code": "MAP-A", "map_name": "A区地图", "floor_code": "F1"}

// 响应
HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 1, "map_code": "MAP-A", "map_name": "A区地图", "floor_code": "F1",
  "url": "", "version": 0, "brand_map_codes": []
}}
```

---

## 2. 地图配置列表

`GET /api/maps`

**作用**：查询地图配置列表，支持按编号/楼层过滤与分页。

**效果**：纯查询，无副作用。按 id 升序。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| map_code | string | 否 | 按地图编号精确过滤；空 = 不过滤 |
| floor_code | string | 否 | 按所属楼层编码精确过滤；空 = 不过滤 |
| limit | int | 否 | 每页条数；<=0 或 >1000 取默认 100 |
| page | int | 否 | 页码，从 1 起；0 视为 1，负数 40001 |

**响应 data**：`{total, items}`——total 为满足过滤条件的总条数，items 为 MapConfigInfo 数组。

**示例**：

```json
GET /api/maps?floor_code=F1&limit=10&page=1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "total": 2,
  "items": [
    {"id": 1, "map_code": "MAP-A", "map_name": "A区地图", "floor_code": "F1",
     "url": "/static/maps/MAP-A_v3.json", "version": 3, "brand_map_codes": []},
    {"id": 3, "map_code": "MAP-B", "map_name": "B区地图", "floor_code": "F1",
     "url": "", "version": 0, "brand_map_codes": []}
  ]
}}
```

---

## 3. 地图配置详情

`GET /api/maps/:id`

**作用**：按主键 id 查询地图配置。

**效果**：纯查询，无副作用。

**路径参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | int | 是 | 地图主键 ID（创建时服务端返回） |

**响应 data**：MapConfigInfo。不存在 → 200 + 40401。

**MapConfigInfo 字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 地图主键 ID（自增） |
| map_code | string | 地图编号 |
| map_name | string | 地图名称 |
| floor_code | string | 所属楼层编码 |
| url | string | 快照最新版本文件的相对路径（形如 `/static/maps/MAP-A_v3.json`）——前端用自己的后端地址拼成完整 URL 下载；空=未保存 |
| version | int | 快照版本号（后端自管，前端不传）：初始 0 = 未保存过快照，首次保存 0→1，之后每次保存 +1 |
| updated_at | string | 更新时间（RFC3339，后端维护只读）：创建时为当前时间，更新元信息或保存拓扑时刷新 |
| brand_map_codes | array | 第三方品牌地图编号映射（`rcs_map_config.brand_map_codes`），元素为 `{brand, map_code}`；空数组=还没配 |

**示例**：

```json
GET /api/maps/1

HTTP 200
{"code": 0, "message": "ok", "data": {
  "id": 1, "map_code": "MAP-A", "map_name": "A区地图", "floor_code": "F1",
  "url": "/static/maps/MAP-A_v3.json", "version": 3,
  "updated_at": "2026-09-11T09:38:50.946+08:00",
  "brand_map_codes": [{"brand": "HIK", "map_code": "A-01"}]
}}
```

---

## 4. 更新地图配置

`PUT /api/maps/:id`

**作用**：整体覆盖更新地图配置。

**效果**：
- 更新传入的全部字段
- **传与库中完全相同的值也算成功**（返回 code 0；只有目标不存在才 40401）
- map_code/map_name 被其他行占用 → 200 + 40901
- **地图编号变更时，该图的点位、线、区域、快照版本行、导航地图挂靠编号同事务改到新编号**（五张表按编号关联，否则旧编号的行会与地图脱钩；导航地图的文件名用的是它自己的编号，磁盘文件不动）
- `brand_map_codes` 是**整体覆盖**：传什么就是什么，空数组或不传 = 清空（页面上删光映射行即清空）；请求体里的 `map_brand` 字段不再写进图（图没有品牌归属），品牌只在重算点位语义等显式操作上出现

**路径参数**：id（必填，主键）

**请求体**：map_code / map_name / floor_code 三字段必填，`brand_map_codes` 可选。

**错误场景**：

| 场景 | 响应 |
|---|---|
| 地图配置不存在 | 200 + 40401 |
| 必填缺失 / 超长 | 200 + 40001 |
| 编号或名称被其他行占用 | 200 + 40901 |
| 同一品牌配了多条编号 | 200 + 40001 |

---

## 5. 删除地图配置

`DELETE /api/maps/:id`

**作用**：按主键删除地图配置。

**效果**：物理删除（不做逻辑删除，没有回收站），并按顺序执行两步级联清理。

**第一步：通知 FMS 删除该图同步出去的站点**（用户口径：删地图要级联清站点并告知 FMS）。取该图全部点位编码调 FMS 删站点接口；FMS 拒绝时**地图不删**，把逐条原因回给操作者（站点可能还绑着载具或仓位，先解绑再删图）；未配置 FMS 地址时只记告警、不因此禁止删图。

**第二步：数据库单事务级联删除 + 磁盘文件清理**：

- 数据库：导航地图 2D 数据行（rcs_nav_map_grid）+ 导航地图版本行 + 导航地图主行（按 map_code 关联）+ 快照版本行（rcs_map_config_version）+ 区域边关联（rcs_map_zone_line）与区域主行（rcs_map_zone）+ 线 + 点 + 点位别名（rcs_map_point_alias）+ smap 留档元素（rcs_smap_element）与导入记录（rcs_smap_import）+ 地图行
- 文件：全部版本快照（版本表 url 清单 + 按地图编号扫目录兜底，孤儿文件一并清）+ 关联导航地图的全部版本文件与编号目录

不存在 → 200 + 40401；FMS 侧有站点删不掉 → 200 + 40001 并列出卡住的站点编码与原因。

**路径参数**：id（必填，主键）

**示例**：

```json
DELETE /api/maps/1

HTTP 200
{"code": 0, "message": "ok"}
```

---

## 6. 快照版本与编辑锁

### 6.1 版本列表

`GET /api/maps/:id/versions`

返回该图全部快照版本，**倒序（最新在前）**，最多 10 条（超出部分保存时已裁剪）：

```json
{"code":0,"message":"ok","data":[
  {"version":11,"url":"/static/maps/MAP-01_v11.json","created_at":"2026-09-20T14:02:11+08:00"},
  {"version":10,"url":"/static/maps/MAP-01_v10.json","created_at":"2026-09-20T13:41:52+08:00"}
]}
```

前端用 `version` 与 `GET /api/maps/:id` 返回的地图 `version` 比对即可标出当前版本。

错误：地图不存在 → 40401；地图存在但从未保存过快照 → 空列表。

### 6.2 回滚到指定版本

`POST /api/maps/:id/rollback`，body `{"version":5}`：

```json
{"code":0,"message":"ok","data":{"version":5,"url":"/static/maps/MAP-01_v5.json"}}
```

**只返回该版本快照地址，不改任何状态**：不动主表 `version`/`url`、不动点线表与区域表、不删文件；版本行存在但文件已缺失 → 40401。所以当前 v6 回滚到 v5 后，下一次保存仍是 v6→**v7**，不会覆盖 v5。

> 回滚 = 把历史版本调出来查看或继续编辑，保存才是真正生效。回滚之后、保存之前，调度侧读到的点线仍是回滚前的最新版本；前端画布显示的是回滚的那一版。

### 6.3 保存时裁剪历史版本

保存最新版本时检查：当前版本号超出 10 的旧版本行与对应快照文件**一起删**。例如 v1~v10 时保存产生 v11，则 v1 的 DB 行与 `MAP-01_v1.json` 一并删除，只留 v2~v11。

- 裁剪发生在保存成功之后；失败只记日志，不影响本次保存的返回。
- 先删 DB 行、再删文件（顺序反了会出现 DB 指向不存在的文件）。

### 6.4 编辑锁（同一时间只允许一人编辑一张图）

**语义**：从进入编辑页到保存/退出，一张图同一时间只允许一个编辑会话；**保存 = 退出编辑**（保存成功后锁自动释放）。回滚、版本列表、导出不受锁影响。

**存储（Redis，单 key）**：

| 项 | 值 |
|---|---|
| key | `{Redis.Key}:map:edit:{map_id}`（配置里的 Key 是命名空间前缀，默认 `rcs`；用主键因为地图编号可改名，主键永远不变） |
| value | JSON：`{"token":"uuid","username":"zhangsan","name":"张三"}` |
| TTL | 10 分钟；编辑中每 2 分钟心跳续期一次 |

- `token`：每次取锁后端新生成的 uuid，会话唯一凭证——心跳、保存校验、释放都只认它；
- `username`：用户唯一标识——判断「锁在自己手里还是别人手里」；
- `name`：展示名，只进提示语。

> 续期与释放用 Lua 条件脚本（值里的 `token` 与请求里的 `token` 相等才操作），Redis 脚本沙箱自带 cjson 库，脚本里解析 JSON 比对即可。

**取锁**：`POST /api/maps/:id/lock`，body `{"username": "zhangsan", "name": "张三"}`（username 必填，name 可选）。

成功：`{"code":0,"message":"ok","data":{"token":"9f6b3e2a-71bd-4e8a-9f3a-c4a2d10b6e11"}}`

失败（40901，提示语写在 `message` 里，无 data）：

```json
{"code":40901,"message":"张三 正在编辑这张图，请稍后再试"}
```

```json
{"code":40901,"message":"你已在别处编辑这张图"}
```

- `name` 为空时，提示语降级为「该地图正在被他人编辑，请稍后再试」；
- 同一用户同一时间只允许一个编辑会话：自己已持锁时再取锁一律 40901，只能回原页面退出编辑、或等锁过期（10 分钟）后再进入；不提供接管接口。

**心跳（续期）**：`POST /api/maps/:id/lock/heartbeat`，body `{"token":"9f6b3e2a-…"}`。成功返回 `{"code":0}`（响应不带任何时间字段）；token 不匹配或锁已不在 → 40901（前端停下定时器、转只读、提示「锁已失效或被他人占用」）。

**释放（退出编辑）**：`DELETE /api/maps/:id/lock`，body `{"token":"9f6b3e2a-…"}`。任何情况都返回成功（释放的语义是「让我的锁消失」，锁已不在或已易主时目标都已达成）：

- 锁在且 token 匹配 → 删除锁；
- 锁已不在 → 不动，返回成功（幂等，重复退出不报错）；
- 锁在且 token 不匹配（已易主）→ **不动别人的锁**，同样返回成功，只记日志。

**保存时校验并释放**：`PUT /api/maps/:id/topology`，请求头 `X-Map-Lock-Token: <token>`

| 锁的状态 | 行为 |
|---|---|
| 无锁（头未带或锁不存在） | 照常保存（脚本、导入等自动化调用方走这条路） |
| 锁在且 token 匹配 | 保存成功 → 释放锁（保存 = 退出编辑） |
| 锁在且 token 不匹配 | 40901「该地图已被他人编辑锁定」，不保存 |
| 保存失败 | 不释放，画布仍在编辑态 |

**生命周期与异常**：

| 情形 | 结果 |
|---|---|
| 取锁成功 | 编辑态：token 存 sessionStorage，启动 2 分钟心跳定时器 |
| 心跳 40901 | 编辑态转只读，停下定时器 |
| 保存成功 / 释放成功 | 回到空闲 |
| 关页面 / 断网 / 浏览器崩溃 | 心跳停止，10 分钟后锁自动过期 |
| Redis 重启 | 所有锁消失，编辑中的页面下次心跳 40901，重新取锁即可（SET NX 保证不会出现两把锁） |
| 后端服务重启 | 锁在 Redis 里不受影响，恢复后心跳照常 |
| 同一张图开两个页签 | 第二个页签取锁 40901，只读进入，不启动定时器 |

**前端配合**：token 存 sessionStorage（刷新页面不断锁，关标签页销毁、走 TTL 兜底）；心跳成功无需处理响应内容；保存请求带上 `X-Map-Lock-Token` 头；取锁失败直接展示 `message`，全部转只读。

**错误码**：

| 场景 | 响应 |
|---|---|
| username / token 缺失或格式非法 | 40001 |
| 地图不存在 | 40401 |
| 别人持锁（取锁） | 40901，message：「XX 正在编辑这张图，请稍后再试」 |
| 自己持锁（取锁） | 40901，message：「你已在别处编辑这张图」 |
| 心跳 / 保存时 token 不匹配 | 40901 |

---

## 7. 整图拓扑查询、结构化查询与保存

### 7.1 快照地址查询

`GET /api/maps/:id/topology`

**作用**：前端进入地图编辑页时获取**快照文件相对路径**，用后端地址拼成完整 URL 下载 JSON 渲染画布。点线结构化数据不经本接口返回。

**效果**：纯查询，无副作用。未保存过快照时 url 为空串；地图不存在 → 200 + 40401。

> 静态快照地址（`/static/maps/*.json`）**跨域可用**：响应带 `Access-Control-Allow-Origin: *` 等 CORS 头，OPTIONS 预检返回 204，前端可直接从自己的源下载。

**响应 data**：

| 字段 | 类型 | 说明 |
|---|---|---|
| url | string | 快照最新版本文件相对路径（形如 `/static/maps/MAP-DEMO_v9.json`，空 = 未保存过快照） |

### 7.2 整图结构化数据

`GET /api/maps/:id/graph`

**作用**：按地图主键返回库内权威的点全量、线全量与区域全量，供调度内核建图；坐标一律毫米原值，不做换算。与 7.1 的分工：7.1 只给快照文件地址（前端画布渲染），本接口给结构化数据。地图不存在 → 40401。

**响应 data（MapGraph）**：

| 字段 | 类型 | 说明 |
|---|---|---|
| map_code | string | 地图编号 |
| points | array | 点全量（按编号升序），字段 id / point_code / point_name / point_type / pos_x / pos_y / pos_z / allowed_device_type / allowed_vehicle_type / direction（optional，未配置为 null） |
| lines | array | 线全量（按主键升序），字段 id / start_point_uuid / end_point_uuid / line_type / angle / in_angle / out_angle / one_way / speed / allowed_device_type / allowed_vehicle_type / zone_codes（所属区域编号列表，按编号升序） |
| zones | array | 区域全量（按区域编号升序），字段 zone_code / zone_name / zone_type / speed_limit_mps / line_ids |

### 7.3 整图保存

`PUT /api/maps/:id/topology`

**直观理解**：前端画布的「保存」按钮——body 是**前端已转好的拓扑 JSON**（字段名与点线表一致），后端一个接口执行完整流程：
**① 编辑锁校验（锁在别人手里 → 40901）→ ② 解析点线入库（按 ID 增删改）→ ③ 点位编码规范化并登记别名 → ④ 区域入库（本次提交带 zones 键时整包替换）→ ⑤ 按统一格式写快照文件（顶层带地图编号与版本号，按版本归档）→ ⑥ 更新地图 url、版本号与版本记录 → ⑦ 裁剪历史版本 → ⑧ 保存成功后释放编辑锁 → ⑨ 异步把已映射语义的点位推给 FMS**。

> **提交格式约定**：前端提交的字段名与点线表列名同名（见下方字段表），画布内部格式由前端在点「保存」时完成转换。

> **版本号规则**（后端自管，前端不传）：首次保存 version 0→1，之后每次保存 +1；快照文件按 `{map_code}_v{n}.json` 归档，文件顶层写着 `map_code` 与 `version`。

**为什么同时存「表」和「文件」**：

| 存什么 | 给谁用 | 原因 |
|---|---|---|
| 点线表与区域表（解析入库） | 调度系统 | 结构化数据（数字坐标、准入车型、避障 id、区域成员）供机器 SQL 查询、按图或按点过滤 |
| JSON 快照文件（按约定字段写盘） | 前端编辑器 | 一次请求取回整图（免分页拼装），按版本归档 = 回滚数据源；点线项与区域项内字段原样保留（后端结构体里没有的字段也不会丢） |

**请求（Content-Type 必须为 application/json，body 为整份拓扑 JSON）**：

```http
PUT /api/maps/5/topology HTTP/1.1
Host: 127.0.0.1:8110
Content-Type: application/json
X-Map-Lock-Token: 9f6b3e2a-71bd-4e8a-9f3a-c4a2d10b6e11

{"map_code":"MAP-A","version":3,"points":[{"id":"4a509e7e-f036-4b98-b930-d9016df1a592","point_code":"000544,000394","point_name":"000544,000394","point_type":"element_16","semantic_type":"CONVEYOR","pos_x":544,"pos_y":394,"pos_z":0,"allowed_device_type":["3"],"allowed_vehicle_type":["4"],"rotation_device_type":["5"],"rotation_vehicle_type":["12"],"auto_replenish":true,"auto_replenish_zone":"1","auto_replenish_vehicle_type":["12"],"auto_replenish_vehicle_full":true,"detour_ok":true,"allow_park":false,"direction":90,"queue_count":2}],"lines":[{"id":"35695e62-2751-4d4a-8eb8-098f0ebc03c7","start_point_uuid":"4a509e7e-f036-4b98-b930-d9016df1a592","end_point_uuid":"0b640ef1-da75-4c0e-87d6-57c608a56039","line_type":"straight","angle":26,"in_angle":26,"out_angle":30,"one_way":false,"bend":"","avoidance_plan_id":1,"allowed_device_type":["2"],"allowed_vehicle_type":["12"],"speed":100,"geom":[{"x":600,"y":400}]}],"zones":[{"zone_code":"Z1","zone_name":"库位存放区","zone_type":"ZONE_STORAGE","line_ids":["35695e62-2751-4d4a-8eb8-098f0ebc03c7"]}]}
```

> 说明：**数值字段一律传数字**（pos_x / pos_y / angle / in_angle / out_angle / speed / avoidance_plan_id）；body 顶层的键只能是 `map_code`、`version`、`points`、`lines`、`zones` 五个（多带 → 40001，免得字段被静默丢掉）；点项、线项与区域项内未被下方字段表列出的**额外字段**后端不解析入库，但**原样保留在快照文件里**；前端不要也不需要传版本号（传了也会被后端自增值覆盖）。

**请求体字段（字段名与点线表一致）**：

| 条目 | 字段 | 必填 | 说明 |
|---|---|---|---|
| 顶层 | map_code | 否 | 整图归属的地图编号；空 = 按目标地图的编号补齐，与本图编号不一致 → 40001 |
| 顶层 | version | 否 | 快照版本号：前端传了也不采信，写盘一律用后端自增值 |
| 顶层 | zones | 否 | 区域数组：不带该键 = 区域保持库内现状不动；带空数组 = 清空该图区域；带内容 = 整包替换 |
| points | id | 是 | 点主键（36 位标准 uuid；**同一张图上重复保存请沿用同一 uuid**，ID 不变则只更新提交的列，其余列保留库内值） |
| points | point_code | 是 | 点编号（本图内唯一且跨图唯一，重复 → 40001） |
| points | point_name | 否 | 点名称；编码被自动规范化且未填名字时用原名兜底 |
| points | point_type | 是 | 点类型（图块类型，如 `element_16`） |
| points | semantic_type | 否 | 点位语义类型（我们的类型 code，如 `LOCATION`）；提交没带且库里也没有时留空并记日志，用重算接口补 |
| points | pos_x / pos_y / pos_z | 是 | 坐标（整数 mm，允许为负；二维地图 pos_z 传 0） |
| points | allowed_device_type / allowed_vehicle_type | 否 | 准入车型 / 准入载具（字符串数组，空数组 = 不限定） |
| points | rotation_device_type / rotation_vehicle_type | 否 | 旋转准入车型 / 旋转准入载具 |
| points | auto_replenish / auto_replenish_zone / auto_replenish_vehicle_type / auto_replenish_vehicle_full | 否 | 自动补充四件套（开关 / 补充区 / 车型 / 满载） |
| points | detour_ok | 否 | 可避让绕路开关（路径冲突时是否允许本点充当绕行中转，默认 false） |
| points | allow_park | 否 | 可休息开关（无任务时是否允许调度把空闲车派到本点待命，默认 false） |
| points | size_mm | 否 | 画布显示尺寸（毫米）；未带 = 保留库内既有值 |
| points | direction | 否 | 点位方向（度、0-360，Y 向上逆时针）；传 null 或未带 = 未配置 |
| points | relate_point_code | 否 | 关联点编码（同图点位编码，按编码引用；未带 = 写空） |
| points | area_code | 否 | 归属区域编码（画地图页框选赋值；未带 = 写空） |
| points | queue_count | 否 | 排队数（该点同时最大可执行任务，0 或空 = 不限制）；未带 = 保留库内既有值 |
| lines | id | 是 | 线主键（36 位标准 uuid） |
| lines | start_point_uuid / end_point_uuid | 是 | 起终点，**必须引用本次提交点集内的点 id**（否则 40001）；**同一对起终点最多 8 条边，超出 → 40901** |
| lines | line_type | 是 | 线类型（`straight` 直线 / `c` C 曲线 / `s` S 曲线） |
| lines | angle / in_angle / out_angle | 否 | 角度族（路径方向角 / 进边角 / 出边角，整数 0-360，0 或 NULL = 未设置，超出 → 40001） |
| lines | one_way | 否 | 单双向（false=双向可走即允许逆行，true=只能 start→end，默认 false） |
| lines | bend | 否 | 弯曲方向（`left` / `right`，空串 = 无弯曲） |
| lines | avoidance_plan_id | 否 | 避障方案 id（**必须已存在**；传 0 或不传 = 不限定） |
| lines | speed | 否 | 限速（数值，非负；传 0 或不传 = 不限制） |
| lines | allowed_device_type / allowed_vehicle_type | 否 | 准入车型 / 准入载具 |
| lines | ctrl_points | 否 | 曲线控制点（世界坐标毫米的 `{x,y}` 数组，与两端点一起构成控制多边形；不传或空数组 = 普通线） |
| lines | geom | 否 | 前端绘制完成的采样折线（世界坐标毫米、按 start→end 方向、不含两端点；曲线的形状由前端给出，后端只读） |
| zones | zone_code / zone_name | 是 | 区域编号（图内唯一，重复 → 40001）/ 区域名称 |
| zones | zone_type | 是 | 区域类型（`ZONE_STORAGE` / `ZONE_TEMP` / `ZONE_BLOCKED` / `ZONE_SPEEDLIMIT`，非法 → 40001） |
| zones | speed_limit_mps | 否 | 限速值（米/秒，非负；仅限速区有意义，其他类型一律忽略不入库） |
| zones | description | 否 | 区域说明 |
| zones | line_ids | 是 | 区域包含的线主键（必须在本批提交线集内，否则 40001；空数组 = 空区域） |
| 写盘 | map_code / version | — | 快照文件顶层由后端写入：`map_code` 取本图编号、`version` 取本次自增值；点项、线项与区域项里若带 `map_code`，先与本图编号校验一致性（不一致 → 40001），写盘时删掉 |

**快照文件格式**（写盘结果，前端下载到的就是它）：

```json
{
  "map_code": "MAP-A",
  "version": 3,
  "points": [
    { "id": "4a509e7e-f036-4b98-b930-d9016df1a592", "point_code": "X000544Y000394", "point_name": "000544,000394", "point_type": "element_16", "pos_x": 544, "pos_y": 394, "pos_z": 0 }
  ],
  "lines": [
    { "id": "35695e62-2751-4d4a-8eb8-098f0ebc03c7", "start_point_uuid": "4a509e7e-f036-4b98-b930-d9016df1a592", "end_point_uuid": "0b640ef1-da75-4c0e-87d6-57c608a56039", "line_type": "straight", "angle": 26, "bend": "", "avoidance_plan_id": 1, "speed": 100 }
  ],
  "zones": [
    { "zone_code": "Z1", "zone_name": "库位存放区", "zone_type": "ZONE_STORAGE", "line_ids": ["35695e62-2751-4d4a-8eb8-098f0ebc03c7"] }
  ]
}
```

> 一份文件只讲一张图：编号与版本在顶层声明一次，点项、线项与区域项内不再重复携带 `map_code`；三个数组缺失时补空数组，保证每份快照形态一致。

**响应 data**：`{url}`——快照文件对外相对路径（形如 `/static/maps/MAP-DEMO_v10.json`）。

**错误场景**：

| 场景 | 响应 |
|---|---|
| body 非合法 JSON / 点缺 id、编号、类型 / uuid 格式非法 / 线缺类型 / 端点不在提交点集内 / angle 或 in_angle 或 out_angle 超 0-360 / speed 为负 / direction 超 0-360 | 200 + 40001 |
| 点编号在提交集合内重复 / 跨图重复 / 规范化后撞车 / 避障 id 不存在 / 区域编号重复或类型非法或关联线不在提交线集内 | 200 + 40001 |
| 顶层出现未知字段 | 200 + 40001 |
| 同一起终点对的边数超过 8 条 | 200 + 40901 |
| 点、线 uuid 被其他地图占用 | 200 + 40901 |
| 该地图被他人编辑锁定（锁存在且 token 不匹配） | 200 + 40901「该地图已被他人编辑锁定」 |
| 地图不存在 | 200 + 40401 |

**前端加载配套**：`GET /api/maps/:id/topology` 拿 url → 拼后端地址下载 JSON → 渲染画布。

---

## 8. 图内区域（rcs_map_zone / rcs_map_zone_line）

**语义**：一个区域是同一张图内**一组边构成的集合**，用于表达库位存放区、临时管制区、禁行区与限速区，供调度与交通管制按区域粒度加锁、按区域限速。区域没有独立的 rpc 与 HTTP 接口：它随整图保存（`PUT /api/maps/:id/topology` 的顶层 `zones` 数组）一起写入，读取走 `GET /api/maps/:id/graph` 的 `zones` 与每条线的 `zone_codes`。

**区域类型（`rcs_map_zone.zone_type`，CHECK 约束限定四种取值）**：

| 取值 | 中文 | 说明 |
|---|---|---|
| ZONE_STORAGE | 库位存放区 | 储位类区域 |
| ZONE_TEMP | 临时管制区 | 临时交通管制 |
| ZONE_BLOCKED | 禁行区 | 区域粒度禁行 |
| ZONE_SPEEDLIMIT | 限速区 | 唯一使用 `speed_limit_mps` 的类型 |

**成员与维护**：

- `rcs_map_zone_line` 的 `(zone_id, line_id)` 是主键、(line_id) 有独立索引，反向查询走它；
- 保存拓扑时，指向本次未提交线的区域成员行会在同一事务里清掉（区域主行保留，成员随线消失而收敛）；
- 本次提交带 `zones` 键时区域整包替换（先删关联再写区域行）；不带该键时区域保持库内现状，前端旧版本保存不会清空区域；
- 区域关联的线必须在本次提交线集内，否则 40001。

---

## 9. 导出与导入

### 9.1 RoboRoute XML（仙工 Roboshop 地图模型）

两个接口配合使用：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/maps/:id/robot-route | 取导出地址（JSON 信封，`data` 里只有 `url`）+ 校验地图是否可导出 |
| GET | /api/maps/:id/robot-route/file | 真正的下载口：返回 XML 附件（内容现场生成，**不写磁盘**） |

**作用**：把该地图当前的点线导成仙工 Roboshop 的地图模型 XML。

**① `GET /api/maps/:id/robot-route` 响应**：

```json
{ "code": 0, "message": "ok", "data": { "url": "/api/maps/190/robot-route/file" } }
```

| data 字段 | 说明 |
|---|---|
| url | 下载地址（相对路径 `/api/maps/<id>/robot-route/file`，前端拼后端地址） |

> 文件名不在这里返回：下载口的 `Content-Disposition` 已经带了。
> 这一调用同时起校验作用（地图不存在 → 40401，地图还没有点位 → 40001），期间会生成一次 XML 用于校验，内容不回给前端；下载时再生成一次。

**② `GET /api/maps/:id/robot-route/file` 响应**：

| 项 | 值 |
|---|---|
| 状态码 | 200 |
| Content-Type | `application/xml; charset=utf-8` |
| Content-Disposition | `attachment; filename*=<地图编号>.RoboRoute.xml`（编号含中文时走 RFC 5987 的 `filename*`） |
| 响应体 | XML 全文（含 `<?xml ... standalone="yes"?>` 文件头） |
| `X-RoboRoute-*` | 本次导出的统计值（Point-Count / Path-Count / Location-Count / Isolated-Point-Count / Self-Loop-Line-Count / Curve-Line-Count，响应头形式，供排查用） |

两个接口出错时都走统一信封（`code` / `message`），不是附件。

**前端用法**：先调 ① 拿 `url`（顺便对「地图不存在 / 没有点位」提前报错），再让浏览器直接跳转到 `getRCSFileBaseUrl() + url` 下载。下载口回的是 XML 附件、不是 JSON 信封，所以不走 axios 拦截器。

**导出前必须先保存**：接口读的是服务端已保存的点线，画布上有未保存的改动时导出的是上一版。

**转换规则**：

| 项 | 规则 |
|---|---|
| 坐标 | 库里的 `pos_x/pos_y/pos_z` **原样写出**（毫米），不做缩放与单位换算 |
| 点编号 | 画布编号不能作 SEER 点名，改为按「前缀 + 4 位序号」生成（`LM0001`），同一份地图每次导出的名字完全一致 |
| 点类型 | 图块类型 → SEER 站点类型：`element_-1`（路径点）/ `element_1`（货架位）/ `element_16`（输送线）/ `element_33`（充电位）/ `element_61`（巷道位）都导成 `HALT_POSITION` + `LM` 前缀；映射表在 `rpc/mapx/internal/logic/roboroute.go` 的 `roboRoutePointTypes` |
| 工作站 | 要车辆停靠作业的图块额外导一条 `location`：`element_16`（输送线）→ `TransferLocation`，`element_33`（充电位）→ `ChargeLocation` + `allowedOperation name="CHARGE"`；工作站坐标与它挂靠的站点相同，`link point` 指回该站点，名字按 `LOC0001` 独立编号 |
| 点的朝向 | 画布没有朝向字段时按样例写 `NaN` |
| 出边 | 每个点的 `outgoingPath` 由 `rcs_map_line` 反推（一条出边一个元素） |
| 路径 | 每条线导出一条有向 `path`（方向照抄），`name = 源 --- 目标`，`length` 取两端点距离（毫米，四舍五入） |
| 自环线 | 起终点相同的线跳过，条数在响应头里返回 |
| 曲线 | `line_type = c / s` 按直线导出（`length` 取两端点距离） |
| 速度 | `speed > 0` 时写 `maxVelocity`；`speed = 0`（未限制）写编辑器默认 500（毫米/秒） |
| 其余路径属性 | `routingCost = 1`、`maxReverseVelocity = 0`、`locked = false` |
| 展示层 | `visualLayout` 覆盖全部点、路径与工作站：点与工作站给 `POSITION_X/Y`（模型坐标 ÷10）与 `LABEL_OFFSET_X/Y = 0`，路径给 `CONN_TYPE = DIRECT` |
| 文件头 | `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`，根节点 `model version="0.0.2" name="<地图编号>"`，元素顺序 `point` → `path` → `locationType` → `location` → `visualLayout` → `property`，末尾带 `robot:modelFileLastModified` |

**错误码**：地图不存在 → 40401；地图还没有点位 → 40001（「地图 X 还没有点位，先保存拓扑再导出」）。

**容量口径**：XML 由 mapx 现场生成后经 gRPC 返回给网关，受 gRPC 单条消息默认 4MB 上限约束（与拓扑保存同一条链路同一个上限）。约 0.9KB/点，即 4000 个点上下。

### 9.2 自研 XML / JSON

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | /api/maps/:id/self-xml/file | `application/xml; charset=utf-8` 附件，文件名 `<地图编号>.map.xml` |
| GET | /api/maps/:id/self-json/file | `application/json; charset=utf-8` 附件，文件名 `<地图编号>.map.json` |

**作用**：把整图导成我们自己的字段命名（`code` / `name` / `type` / `x` / `y` + `allowPark` / `detourOk` / `stationType` / `stationHeightMm` / `autoReplenish`），坐标毫米、允许为负，与画布和库内口径完全一致；XML 版给存档与人工阅读，JSON 版给机器读取，两份是同一套结构、同一套统计。

**文档结构**：

| 层级 | 字段 |
|---|---|
| 根节点 map | `code` / `name` / `floor` / `version`（快照版本号） |
| points > point | `code` / `name` / `type`（点位语义类型）/ `x` / `y` / `z` / `allowPark` / `detourOk` / `stationType` / `stationHeightMm` / `autoReplenish` |
| lines > line | `id` / `start` / `end`（写点位编码而不是 uuid）/ `type` / `oneWay` / `speed` / `angle` / `inAngle` / `outAngle` / `ctrlPoint` 数组 |
| zones > zone | `code` / `name` / `type` / `speedLimit` / `description` |

**统计口径**（`SelfXmlExportInfo`）：`content`（全文）、`file_name`、`point_count`、`line_count`、`zone_count`、`curve_count`（其中带曲线控制点的线段数）。地图不存在 → 40401。

### 9.3 smap 导出与导出原料

**导出结果**：`GET /api/maps/:id/smap/export` 返回 JSON 信封（同时起校验作用，地图不存在 → 40401，没有点位 → 40001），`GET /api/maps/:id/smap/file` 返回 `.smap` 附件（Content-Type `application/json; charset=utf-8`，Content-Disposition 用 RFC 5987 的 `filename*`），统计值放在 `X-Smap-*` 响应头（Point-Count / Curve-Count / Feature-Count / Normal-Pos-Count / Derived-Dir-Count / Ignore-Dir-Count / Synthesized-Controls / Grid-Source）。

**内容口径**：

| 项 | 规则 |
|---|---|
| 坐标 | 库内毫米坐标减掉导入时记录的平移量（`rcs_smap_import.origin_x_mm` / `origin_y_mm`）后换算回米写出，与源文件坐标口径一致 |
| 点位 | 写 `advancedPointList`；朝向按连线派生，没有连线的孤立点写 `ignoreDir` |
| 线段 | 写 `advancedCurveList`，双向线写正反两条 |
| 特征线 | 导入时留档的 `advancedLineList` 原样回写（手工画的图为 0） |
| 留档字段 | 节点朝向与属性、曲线控制点按 `rcs_smap_element` 的原文回填；控制点缺失时按直线三分点新算并在统计里计数 |
| 2D 导航层 | 优先取 `rcs_nav_map_grid` 的库内 2D 数据（`grid_source=nav_grid`），库内没有时回退解析关联导航文件（`nav_file`），都没有则不含导航层（`none`）；`normal_pos_count` 为 0 且 `warnings` 会提示「不含 2D 导航层，车体不能直接用」 |
| 激光平移与旋转烘焙 | 该图有激光层且调过平移或旋转时，把平移与旋转量烘焙进 `normalPosList` 并在 `warnings` 里说明；没有栅格时提示平移与旋转未生效 |

**导出原料**：`GET /api/maps/:id/smap/source`（`GetSmapSource`）——拼装产物在前端做，后端只给前端拿不到的三块：

| 字段 | 说明 |
|---|---|
| map_code | 地图编号 |
| has_import | 有没有 smap 导入记录（false = 手工画的图，平移量按 0、元信息用默认值） |
| origin_x_mm / origin_y_mm / resolution / smap_version / smap_map_name | 导入记录里的坐标平移量、分辨率、格式版本与地图名 |
| min_x_mm / min_y_mm / max_x_mm / max_y_mm | 导入件的原始包络（并进 header 的 minPos / maxPos） |
| normal_pos_raw | 导航地图 2D 点云原文（原样内嵌，浮点写法不变形） |
| grid_map_name / grid_resolution / grid_min_x_mm / grid_min_y_mm / grid_max_x_mm / grid_max_y_mm | 2D 层的地图名与包络 |
| elements | 导入时留档的 smap 原始元素清单，元素字段 `kind`（point / curve / feature）、`ref_key`、`raw` |

### 9.4 smap 导入

`POST /api/maps/:id/smap/import`（multipart/form-data）

| 表单字段 | 必填 | 说明 |
|---|---|---|
| file | 是 | .smap 文件（文件字段名固定为 file）；单个文件上限 50MB，由 handler 边写边数字节判定 |
| nav_map_code | 否 | 导航地图编号（空则按 `NAV-<地图编号>` 取） |
| brand | 否 | 导航地图适用品牌 |
| agv_type | 否 | 导航地图适用车型 |

**流程**：网关把上传字节流式写进导航地图目录的 `.tmp/`（文件不经过 gRPC），rpc 侧读文件后解析并分出两套产物：

- **拓扑产物**：点位与线段整包替换进 `rcs_map_point` / `rcs_map_line`（主键由「地图编号 + 点位编码」确定性派生，重复导入同一张图不产生重复行）；正反两条曲线合并成一条双向线；曲线端点缺失时补建节点并计数；留档元素写 `rcs_smap_element`，点位原名写 `rcs_map_point_alias`（`alias_source=smap`），导入记录写 `rcs_smap_import`（一张图一行，重复导入整行覆盖）；语义类型按 `SEER` 品牌查 `rcs_map_element.brand_types` 回填，查不到的留空并在日志与重算清单里点名。
- **导航产物**：2D 地图部分（header 二维元信息 + `normalPosList` 栅格）归档到导航地图名下（已有导航地图则追加一个版本，没有则新建），同时把解析结果写 `rcs_nav_map_grid`。

两个产物不是同一个事务：先写导航（失败即整单返回，拓扑不动），再写拓扑。导入成功后异步生成一份 SEER 品牌地图包。

**响应 data（ImportSmapReply）**：

| 字段 | 说明 |
|---|---|
| map_code / smap_map_name / smap_version / map_type | 拓扑地图编号，以及 smap 里的地图名、格式版本、地图类型 |
| point_count / line_count / synth_point_count / bidirectional_line | 导入的点位数、线段数（正反两条曲线合并成一条双向线）、按曲线端点补建的节点数、双向线数 |
| feature_count / normal_pos_count / alias_count | 留档的地图特征线数、导航栅格点数、登记的点位别名数 |
| origin_xmm / origin_ymm | X / Y 方向坐标平移量（毫米） |
| notes | 容错处理说明（中文，前端原样展示） |
| nav_map | 导航产物（新建的导航地图或追加的新版本） |
| grid_source / grid_point_count | 2D 地图部分解析结果（`smap` = 已写入导航地图数据、`none` = 源文件没有 2D 层）与栅格点数 |

**把 smap 的 2D 点云存成激光层**：`POST /api/maps/:id/laser/smap`（multipart，文件字段 file）——解析只认 `header.mapName` 与 `normalPosList`，写入 `rcs_map_laser`（品牌 SEER、类型 pointcloud），画布随后就能按常规激光底图显示。

### 9.5 品牌包导出原料与品牌包导入

**导出原料**：`GET /api/maps/:id/package/source?brand=<SEER|HIK|HUARUI>`（`GetPackageSource`）——拼装产物在前端做，后端只给只读原料：

| 字段 | 说明 |
|---|---|
| map_code / brand | 地图编号与本次目标品牌 |
| vendor_meta | 该品牌导入时留档的顶层原文（海康的 mapInfo/areaList 等，原样回写） |
| points / lines | 各对象在该品牌桶里的原始属性原文（元素字段 `key` 与 `raw`；点位 key 是点编码、线段 key 是线主键 uuid），没有该品牌桶时 `raw` 为空 |
| transitions | 我们的元素类型 → 该品牌元素编号（来自「地图元素」页的品牌映射） |

**导入**：`POST /api/maps/:id/import-package`（multipart/form-data）

| 表单字段 | 必填 | 说明 |
|---|---|---|
| brand | 是 | 品牌（SEER / HIK / HUARUI，页面手选，后端不做内容探测判定）；空值 → 40001「请先选择地图品牌」 |
| 文件 | 是 | 多文件按相对路径上传（浏览器目录上传会带 webkitRelativePath）或整包一个 zip；总量上限 200MB，边写边数字节判定 |

**流程**：网关把上传内容写成临时目录（zip 解包、多文件按相对路径保持目录结构），只把目录令牌交给 rpc；rpc 侧按品牌解析：SEER 走 smap 导入链路，HIK 与 HUARUI 走统一解析与编排（点线整包替换 + 激光层 + 附件留档 + 字段字典抽取）。导入成功后异步生成一份该品牌地图包，并把已映射语义的点位推给 FMS。

**写入内容**：点线进 `rcs_map_point` / `rcs_map_line`（品牌原始属性按品牌分桶存 `brand_raw`，键为品牌字段路径，与 `rcs_map_field_dict.field_key` 对应）；区域进 `rcs_map_zone`；激光进 `rcs_map_laser`（`kind` 取 pointcloud / grid / binary / none）；包内每一个文件登记进 `rcs_map_source_file`（`category` 取 topo / laser / binary / background / safety / compress / meta / raw），导出时按包内相对路径复原目录结构；品牌字段路径抽成 `rcs_map_field_dict` 行供画布按品牌动态渲染。

**响应 data（MapPackageImportReply）**：`map_code` / `brand` / `map_name` / `version` / `point_count` / `edge_count` / `area_count` / `laser_kind` / `laser_point_count` / `laser_width_px` / `laser_height_px` / `attachment_count` / `field_dict_count` / `mapped_points` / `unmapped_points`（语义未映射的点位）/ `notes`（容错与提示）/ `source_files`（包内文件清单，最多 10 条）。

---

## 10. 导航地图（rcs_nav_map）

**语义**：导航地图是前端上传的导航文件，与拓扑地图一对一（`rcs_nav_map.map_code` 唯一）。文件是 smap 时，归档内容只保留它的 **2D 地图部分**（拓扑的权威在库内点线表，不重复存），解析结果写 `rcs_nav_map_grid`；其他格式原样归档。

**归档规则**：文件放在 `NavMapDir/<导航地图编号>/` 下，文件名 `<编号>_v<版本><原后缀>`，对外路径 `/static/navmaps/<编号>/<文件名>`；版本号后端自增，保留最近 10 版（替换时裁剪，库行与文件一起删）。

**接口**：

| 方法 | 路径 | 请求 | 响应 data |
|---|---|---|---|
| POST | /api/nav-maps | multipart：`nav_map_code`（必填）/ `map_code`（必填，关联的拓扑地图必须已存在，否则 40401）/ `brand` / `agv_type` / `file` | NavMapInfo |
| GET | /api/nav-maps | `nav_map_code` / `map_code` / `brand` / `agv_type` / `limit` / `page` | `{total, items}` |
| GET | /api/nav-maps/:id | — | NavMapInfo（不存在 → 40401） |
| PUT | /api/nav-maps/:id/file | multipart：`file` | NavMapInfo（版本号 +1，元信息不变） |
| DELETE | /api/nav-maps/:id | — | 空（含全部版本文件与编号目录一起清） |
| GET | /api/nav-maps/:id/versions | — | 版本数组（倒序，最新在前，最多 10 条） |
| POST | /api/nav-maps/:id/rollback | body `{"version": n}` | NavMapVersionInfo（只返回该版本文件地址） |

**NavMapInfo 字段**：

| 字段 | 说明 |
|---|---|
| id / nav_map_code / map_code | 主键、导航地图编号（唯一）、关联的拓扑地图编号 |
| brand / agv_type | 适用品牌 / 适用车型（空=不限） |
| file_path | 最新版本文件相对路径（形如 `/static/navmaps/NAV-A/NAV-A_v1.smap`） |
| version | 最新版本号（首次上传即 1） |
| updated_at | 更新时间（上传或换文件时刷新） |
| grid_point_count / grid_resolution / grid_source | 2D 导航栅格点数、分辨率（米/栅格）、数据来源（`smap` = 从 .smap 解析写入，空=没有 2D 数据） |

**换文件与 2D 数据**：换成不是 smap 的文件时，`rcs_nav_map_grid` 的旧行会被删掉，保证 2D 数据始终与当前文件同源；解析或写入失败只记日志，不阻断创建与替换。

**回滚语义**：`POST /api/nav-maps/:id/rollback` 只返回该版本文件地址，不动主表版本与文件、不动 2D 数据；版本不存在或该版本文件已缺失 → 40401。下次上传仍按主表 version+1 生成新版本。

**rcs_nav_map_grid 存什么**：smap 的 2D 地图部分——`map_name`（header.mapName，车端按地图名匹配，导出回填）、`map_type`、`smap_version`、`resolution`、包络 `min_x_mm` / `min_y_mm` / `max_x_mm` / `max_y_mm`、栅格点数 `normal_pos_count`、栅格数组原文 `normal_pos_raw`（导出原样写回，保证浮点写法与源文件一致）、`file_path`（2D 层归档文件路径，仅留痕）。一行对一张导航地图（`nav_map_code` 唯一）。

---

## 11. 避障方案（矩形避障范围字典）

**作用**：配置「前/后/左/右」四个避障距离（mm）。线表的 `avoidance_plan_id` 引用本表主键——RCS 调度时按边的引用查出这一行，随指令下发车端。本表是**全局字典**（不挂地图，跨图复用）。

**数据字段**（AvoidancePlanInfo）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 ID（自增） |
| plan_code | string | 编号（业务键，**唯一**，最长 50） |
| plan_name | string | 名称（最长 100） |
| front_mm / rear_mm / left_mm / right_mm | int | 前/后/左/右避障距离（mm，0 视为未设置） |

### 11.1 创建避障方案

`POST /api/avoidance-plans`

**请求体**：`plan_code`（必填，唯一，最长 50）、`plan_name`（必填，最长 100）、`front_mm` / `rear_mm` / `left_mm` / `right_mm`（可选，非负）。

**响应 data**：AvoidancePlanInfo（含自增 id）。

**错误场景**：缺编号或名称为 40001；距离为负 40001；编号重复 40901。

### 11.2 避障方案列表

`GET /api/avoidance-plans`

**查询参数**：`plan_code`（编号模糊过滤，空=不过滤）、`limit`、`page`。

**响应 data**：`{total, items}`（items 为 AvoidancePlanInfo 数组），按 id 升序。

### 11.3 避障方案详情

`GET /api/avoidance-plans/:id`

按主键查询单个方案（线编辑时回显已选方案用）。不存在 → 200 + 40401。

### 11.4 更新避障方案

`PUT /api/avoidance-plans/:id`

整体覆盖更新（字段同创建）；编号冲突检查**排除自身**；相同值更新按成功处理。不存在 → 40401；编号被其他方案占用 → 40901；校验失败 → 40001。

### 11.5 删除避障方案

`DELETE /api/avoidance-plans/:id`

删除前做引用保护：仍被线表（`rcs_map_line.avoidance_plan_id`）引用时拒绝删除。

| 场景 | 响应 |
|---|---|
| 不存在 | 200 + 40401 |
| 仍被线引用 | 200 + 40901「避障方案被 N 条线引用，请先解除引用」 |

> 方案被删后线上的 `avoidance_plan_id` 会变成悬空引用——该图下次保存会被「避障 id 不存在」（40001）拦下，调度按边取避障参数也取不到。解除方式：先在画布上把引用该方案的线改掉或删掉（或直接删掉那张图，连带删线），再删除方案。

**通用说明**：四个距离字段可空，**0 视为未设置**；分页与错误码规范同地图配置。本表暂无创建与更新时间列。

---

## 12. 点位与站点归属

### 12.1 点位清单

`GET /api/maps/:map_code/points`（路径用**地图编号**，不是主键）

**作用**：取该图点位全量（含站点绑定与业务字段），供绑定页与同步体检使用；与 `GET /api/maps/:id/graph` 的分工是 graph 给调度内核建图（点 + 线 + 区域），本接口只出点位与绑定。地图不存在 → 40401，点位为空返回空数组。

**响应 data**：`{map_code, points}`，points 为 MapPointStation 数组（按点编号升序）：

| 字段 | 说明 |
|---|---|
| id / point_code / point_name / point_type | 点主键、编号、名称、图块类型 |
| pos_x / pos_y / pos_z | 坐标（毫米原值，坐标权威在本表；FMS 站点不存坐标） |
| station_code | 绑定的 FMS 站点编码（空 = 未绑定） |
| semantic_type | 点位语义类型（空 = 未映射） |
| normalized_from / normalized_to / notice | 编码规范化回显（清单里恒为空，只有绑定时可能非空） |
| allowed_device_type / allowed_vehicle_type | 准入车型 / 允许的载具类型 |
| rotation_device_type / rotation_vehicle_type | 要求旋转的车型 / 载具类型 |
| station_type | 站点类型 GROUND / RACK / CONVEYOR / CHARGE / OTHER |
| station_height_mm | 输送线对接面高度（mm，0=未配） |
| auto_replenish / auto_replenish_zone / auto_replenish_vehicle_type / auto_replenish_vehicle_full | 自动补充四件套 |
| detour_ok | 可避让绕路（默认 false） |
| allow_park | 可休息（默认 false） |
| direction | 点位方向（度，未配置为 null） |
| rack_code / column_code / level_no / rack_name | 货架归属与货架名称（按编号引用，查不到货架时名称为空） |

### 12.2 绑定站点

`PUT /api/maps/:map_code/points/:point_code/station`，body `{"station_code": "S1"}`，query 参数 `force`（可选）

**校验顺序**：

1. 地图编号存在（不存在 → 40401）
2. 点位编码处理：不含逗号的原样使用；「数字,数字」形态规范化成 `X000604Y000282` 后使用，原名写进 `rcs_map_point_alias`（`alias_source=bind`），点位名称为空时用原名兜底；含逗号但不是数字对形态的 → 40001 要求手工改名
3. 站点编码合规：与 FMS 站点编号规则 `[A-Za-z0-9_-]{1,64}` 一致（不合规 → 40001 并给建议）
4. 站点在 FMS 侧存在（读 FMS 站点清单）：查不到 → 40001 并说明可带 force；FMS 未配置或不可达 → 50301 并说明可带 force
5. 点位存在（不存在 → 40401）+ 同一张图内该站点未被别的点位占用（已被占用 → 40901）

`force=true` 跳过 FMS 存在性校验（仅用于 FMS 暂时不可达或站点还没建好时先绑后核，编码规则仍校验），跳过时记错误日志留痕。

编码规范化与绑定在**同一事务**里完成（点位编码改写、别名行、站点绑定三者要么全变要么全不变）；线、区域按点位主键引用，改编码不影响它们。同一配对重复绑定返回成功（幂等）。

**响应 data**：MapPointStation（发生规范化时 `normalized_from` / `normalized_to` / `notice` 非空，`notice` 形如「已自动把点位编码 000604,000282 规范化为 X000604Y000282（原名已登记到点位别名表 rcs_map_point_alias 留档）」）。

### 12.3 解绑站点

`DELETE /api/maps/:map_code/points/:point_code/station`

清空点位的 `station_code`，不动坐标与点位本身；本来没绑定也返回成功（幂等）。

### 12.4 可避让绕路开关

`PUT /api/maps/:map_code/points/:point_code/detour`，body `{"detour_ok": true}`

写入 `rcs_map_point.detour_ok`（幂等，写同一个值也成功）。该开关决定路径冲突（前方被占、停靠位放不下、等不到下一段路权）时是否允许本点充当绕行中转，建议只标通道类点位；改完由调度侧按图重载周期生效，不用重启调度进程。响应 data 为更新后的 MapPointStation。

### 12.5 单图同步体检

`GET /api/maps/:map_code/points/sync-check`

只读接口，回答「这张图的点位与 FMS 站点哪里对不上」。地图不存在 → 40401。

**四类差异（issues[].category）**：

| 类别 | 等级 | 含义 | 处理建议 |
|---|---|---|---|
| POINT_WITHOUT_STATION | WARN | 地图上有该点位（含坐标）但没有绑定 FMS 站点编码 | 绑到一个 FMS 站点编码；只是通道点可忽略 |
| STATION_MISSING_IN_FMS | ERROR | 绑定的站点编码在 FMS 站点清单里不存在（站点改名或归档） | 改绑到新编码，或解绑这个悬空绑定 |
| STATION_WITHOUT_MAP | WARN | FMS 侧存在该站点，本图没有它的点位，且它在任何地图上都没有绑定（还没有地图） | 补建点位并绑定 |
| POINT_CODE_ILLEGAL | ERROR | 点位编码含逗号且不是「数字,数字」形态，无法自动规范化 | 人工改名 |

**两个参考块（不计入问题数）**：

- `other_map_stations`：本图没有该站点的点位，但它在其它地图上已绑定——只表示「不属于本图」，不是差异；
- `auto_normalizable`：可自动规范化的编码清单（`from` → `to`），绑定或保存时会被自动改写并留档，因此不算问题。

**计数口径**：`issue_total = issue_point_without_station + issue_station_missing_in_fms + issue_station_without_map + issue_point_code_illegal`；`issue_station_without_point` 是旧口径（本图没有点位绑定的 FMS 站点总数 = 第 ③ 类 + 跨图参考数）；`other_map_station_count` 与 `auto_normalizable_count` 是参考数。

**FMS 不可达时降级**：`fms_queried=false`，只出 ① 与 ④ 两类，②③ 两类无法判定，原因写在 `fms_message` 里，报告本身不报错。`fms_station_total` 为 FMS 侧站点总数（未取到为 0）。

### 12.6 站点归属跨图体检

`GET /api/maps/stations/sync-check`（无入参）

站点清单来自 FMS，绑定关系来自本地 `rcs_map_point`，直接回答「哪些站点已经有地图、哪些还没有地图、哪些绑定已经悬空」。

| 字段 | 说明 |
|---|---|
| fms_total | FMS 站点总数（未取到为 0） |
| with_map / without_map | 已有地图的站点数（至少一条可用绑定）/ 还没有地图的站点数（正常过渡态） |
| dangling | 悬空绑定条数（地图、点位或站点已不存在） |
| stations_with_map / stations_without_map | 两类站点清单（按站点编码升序），元素字段 `station_code` / `station_name` / `area_code` / `vehicle_type` / `maps`（已绑定地图编号升序）/ `point_count` / `dangling_binding_count` / `suggestion` |
| dangling_bindings | 悬空绑定清单，元素字段 `map_code` / `point_code` / `station_code` / `reason`（BINDING_TO_MISSING_MAP / BINDING_TO_MISSING_POINT / STATION_MISSING_IN_FMS）/ `detail` / `suggestion` |
| local_bindings | 本地可用绑定清单（地图在、点在），元素字段 `map_code` / `point_code` / `station_code`；FMS 不可达时也能看 |
| fms_queried / fms_message | FMS 站点清单是否取到、取不到时的原因 |
| local_binding_total | 本地绑定总条数（可用 + 悬空） |

FMS 不可达时 `with_map` 与 `without_map` 未判定（恒为 0），只基于本地绑定给出 `dangling` 与 `local_bindings`。

### 12.7 FMS 直连（rpc/mapx/internal/fms/）

三条内部接口都由 rcs-map 直连 FMS，请求头固定 `X-Fms-Service-Token: <Fms.ServiceToken>`，地址取 `Fms.BaseURL`（`etc/map.yaml` 的 Fms 段，单次请求超时默认 5000ms，响应体读取上限 4MB）。

| 方向 | 方法 | 路径 | 请求体 | 用途 |
|---|---|---|---|---|
| RCS → FMS（读） | GET | /internal/v1/catalog/stations | — | 拉站点清单：绑定站点时校验站点存在、同步体检判定第 ②③ 类差异、归属体检取站点清单。响应兼容 `{data:{items:[…]}}` 与 `{data:[…]}` 两种形状，站点属性里读 `areaCode` / `vehicleType`（大小写不敏感），存在性只看 `code` |
| RCS → FMS（写） | POST | /internal/v1/catalog/stations/delete | `{"codes":["S1","S2"]}` | 删地图时级联清站点。响应给 `data.deleted` 与 `data.failures[]`（`code` + `reason`）；任一站点删不掉时**地图不删**，把逐条原因回给操作者；未配置 FMS 时只记告警、不禁止删图 |
| RCS → FMS（写） | POST | /internal/v1/maps/sync-push | `{"map_code":"MAP-A","points":[{"point_code","point_name","semantic_type","station_type","pos_x","pos_y"}]}` | 把该图的点位推给 FMS 建或更新站点档案 |

**推送口径**：只推**语义类型非空**的点位（语义为空说明该点的图块编号在品牌映射里查不到，FMS 分不了类，推过去只是噪音）；点位名称空时用点位编码兜底。触发时机是保存拓扑成功后与品牌包导入成功后各一次，**异步执行**（30 秒超时），未配置 FMS 时静默跳过，推送失败只记日志不影响保存，下一次保存自然重试（FMS 侧按编码幂等）。

---

## 13. 地图元素与语义类型

**语义类型的来源**：`rcs_map_point.semantic_type` 是权威值，取值是我们自己的类型 code（LOCATION / RACK_HIGH / CHARGER / PARKING 等，配置在 `rpc/mapx/etc/map.yaml` 的 `Map.SemanticTypes`，共 18 个）。映射关系由 `rcs_map_element` 表达：**一个 code 一行**（类型是根），第三方品牌下的编号挂在 `brand_types` 数组里。

**MapElementInfo 字段**：

| 字段 | 说明 |
|---|---|
| id / code / name | 主键、我们自己的类型编码（唯一，如 LOCATION）、类型名称（中文，如 库位） |
| sync_fms | 是否同步成 FMS 站点（储位类四类为真） |
| brand_types | 该类型在各品牌下的编号（`{brand, brand_type}` 数组，可空 = 还没配；同一品牌在同一类型下可以有多个编号） |
| icon | 图例编号（迁移 078 起存门户自绘图标名，如 `location`、`rack-high`；兼容旧值 `element_NN`） |
| enabled | 是否启用（false = 保存、导入与重算都跳过这一条） |
| remark | 备注（图例出处 / 歧义说明 / 是否待现场确认） |
| created_at / updated_at | 创建与更新时间 |

**接口**：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/maps/map-elements?brand=&code= | 列表（都空 = 不过滤；字典体量小，不分页） |
| POST | /api/maps/map-elements | 新增；`code` 唯一，重复 → 40901；不传 `sync_fms` = false，不传 `enabled` = 启用 |
| GET | /api/maps/map-elements/:id | 详情（不存在 → 40401） |
| PUT | /api/maps/map-elements/:id | 整体覆盖；`code` 改成已占用的 → 40901；`brand_types` 传空数组 = 清空品牌映射；`icon` / `remark` 传空即清空 |
| DELETE | /api/maps/map-elements/:id | 删除本行，不动已写入的点位语义（用重算接口收敛） |
| GET | /api/maps/map-elements/icons | 内置图例清单（编码、文件名与取图路径） |
| GET | /api/maps/map-elements/icons/:code | 取单个图例 |

**语义候选值清单**：`GET /api/maps/map-elements/semantic-types` 返回 `items`（语义类型 code + 中文名，来源是配置 `Map.SemanticTypes`）与 `self_fields`（自研属性字段清单，业务属性管理页的「关联自研属性字段」下拉用，省一次往返）。

**整图重算语义**：`POST /api/maps/:map_code/points/rerank?brand=<SEER|HIK|HUARUI>`（品牌必填，缺失 → 40001）。按该品牌查 `rcs_map_element.brand_types` 整图重算：查得到的写入、查不到的**清空**（不猜），未映射点位在 `unmapped` 清单里逐条点名（`point_code` + `point_type` 原值），人补映射后再跑一次即可。响应含 `map_code` / `brand` / `updated`（本次写入、改写或清空的点位数，幂等：连跑两次第二次为 0）/ `total` / `unmapped`。地图不存在 → 40401。

**未映射不是错误**：保存拓扑、smap 导入与品牌包导入遇到查不到的类型都照常成功，把语义留空并记日志；语义缺失清单由重算接口反复点名。

---

## 14. 品牌字段与字典

**字段字典（rcs_map_field_dict）**：导入品牌地图时把该品牌对象上的字段（含嵌套路径）抽成字典行，画布属性面板按「品牌 + 对象类型」拉字典动态渲染（分组折叠），字段值存在 `rcs_map_point.brand_raw` / `rcs_map_line.brand_raw`（按品牌分桶：`{品牌: {字段路径: 值}}`），两者靠 `field_key` 对应，导出时按原路径写回。

| 接口 | 说明 |
|---|---|
| GET /api/maps/map-field-dict?brand=&scope= | 字段清单。`brand` 空 = 全部品牌（业务属性管理页一次看全三家）；`scope` 取 point / line / area，空 = 全部 |
| PUT /api/maps/map-field-dict/:id | 人工维护：`label` / `group_name` / `options_json` / `sort_no` / `editable` / `remark`；字段路径与品牌不可改。`self_field` 与 `self_field_enabled` **不传 = 不改**，`self_field` 传空串 = 取消关联 |

**MapFieldDictInfo 字段**：`id` / `brand` / `scope` / `field_key`（字段路径，如 `amr.attribute.allowPark`）/ `label`（中文标签，空=前端显示 field_key）/ `value_type`（string / number / bool / array / object）/ `options_json`（枚举候选）/ `group_name` / `sort_no` / `editable` / `sample_value` / `source`（import=导入时自动抽取 / manual=人工新增）/ `remark` / `self_field` / `self_field_enabled`。

**自研属性关联（`self_field` / `self_field_enabled`）**：把某个品牌字段挂到我们点位或线段上的业务列。开关默认关闭，关着时导入与手改品牌字段都不动自研列；打开后导入该品牌地图、或在画布上改这个品牌字段时，把值同步写到我方对应列上。`self_field` 的取值域来自 `rcs_map_self_field`（表空时退回配置 `Map.SelfFields` 与代码兜底）。

**点位品牌字段**：

| 接口 | 说明 |
|---|---|
| GET /api/maps/:map_code/points/:point_code/brand-fields | 取该点的全部品牌字段；没有品牌字段（手工画的图）返回空列表，不是错误 |
| PUT /api/maps/:map_code/points/:point_code/brand-fields | body `{"fields":[{"field_key":"amr.attribute.allowPark","value_json":"true"}],"brand":"HIK"}`；只给要改的字段（按路径定位），其余字段原样保留；`brand` 空 = 主品牌桶（按 SEER → HIK → HUARUI 取第一个有值的） |

**MapPointBrandFields 字段**：`map_code` / `point_code` / `fields`（主品牌那一段，老前端只读它）/ `brand` / `groups`（按品牌分组的全量桶，画布「品牌字段」区按品牌分组摊开显示）。

**线段品牌字段**：`GET` / `PUT /api/maps/:map_code/lines/:line_id/brand-fields`，口径与点位完全一致，标识换成线主键（uuid）；响应结构为 `map_code` / `line_id` / `fields` / `brand` / `groups`。

**自研业务属性字段（rcs_map_self_field）**：登记我们点与线上的业务列（编码 / 中文名 / 值类型 / 是否可改 / 排序 / 说明），是「业务属性管理」页的骨架，也是品牌字段「关联自研属性字段」下拉的取值域。

| 接口 | 说明 |
|---|---|
| GET /api/maps/map-self-fields?scope= | 清单（`scope` 空 = 全部）。来源三级：库表 → 配置 `Map.SelfFields` → 代码兜底 |
| POST /api/maps/map-self-fields | 新增；`code` 形态限「小写字母开头 + 小写字母、数字、下划线」（与库里的业务列同名），`(scope, code)` 重复 → 40901 |
| PUT /api/maps/map-self-fields/:id | 改 `label` / `value_type` / `editable` / `sort_no` / `remark`；`scope` 与 `code` 是键，本接口不改 |
| DELETE /api/maps/map-self-fields/:id | 删除本行；已配关联的品牌字段不受影响，只是关联目标在页面上显示为未找到 |

| MapSelfFieldInfo 字段 | 说明 |
|---|---|
| id / scope / code | 主键；`point` 或 `line`；属性编码（与 `rcs_map_point` / `rcs_map_line` 的业务列同名，如 `allow_park`、`speed`） |
| label / value_type | 中文名；bool / number / string / array（品牌字段值往我方列上映射时的取值口径） |
| editable / sort_no / remark | 画布上是否允许编辑；排序号；这个属性是干什么的 |

种子内容覆盖点位侧 `allow_park` / `detour_ok` / `station_type` / `station_height_mm` / `auto_replenish` / `direction` / 四个车型数组列，线段侧 `speed` / `one_way`；其中四个车型数组列只登记未接线（三家的字段字典里还没有同义字段）。

---

## 15. 激光层

**语义**：`rcs_map_laser` 是三家的激光数据统一存储，一张拓扑地图一行（`map_code` 唯一）。`kind` 取 pointcloud（仙工 `normalPosList` 轮廓点列）/ grid（华睿 pgm 灰度栅格）/ binary（解不开的二进制留档）/ none（该图没有激光层）。

| 接口 | 说明 |
|---|---|
| GET /api/maps/:id/laser?level=0-3 | 取激光层元信息，并按需渲染该级别的底图 PNG（返回相对路径）。`level` 是渲染级别 0-3（0=原始分辨率，3=1/8），越界按 1 处理；没有激光层时返回 `has_laser=false` 的壳，不是错误。取数时一并把元信息写成同级目录的静态 JSON，画布直接加载原点 / 分辨率 / 平移与旋转参数，不必再走接口 |
| GET /api/maps/:id/laser/points | 取激光点云原文（`points_json` 为米制 `[{x,y}]` 数组），供前端用 Canvas 自己渲染底图；只对 `kind=pointcloud` 有意义，华睿那种几十 MB 的栅格不下发（`kind=grid` 时前端走后端渲染路径）。没有激光层时返回 `kind=none` 的壳 |
| PUT /api/maps/:id/laser/offset | body `{"offset_x_mm":0,"offset_y_mm":0,"rotation_deg":0.0}`，保存激光底图的平移与旋转参数。这些参数不改底图本身（渲染缓存不含它们，前端实时摆放），生成或导出品牌件时烘焙进激光数据 |

**MapLaserInfo 字段**：`map_code` / `brand` / `kind` / `map_name` / `resolution`（米/像素或米/点）/ `origin_x_mm` / `origin_y_mm`（栅格原点，可负）/ `width_px` / `height_px` / 包络 `min_x_mm` / `min_y_mm` / `max_x_mm` / `max_y_mm` / `point_count` / `offset_x_mm` / `offset_y_mm` / `rotation_deg` / `image_path`（底图 PNG 相对路径）/ `has_laser`。

**MapLaserPoints 字段**：`map_code` / `brand` / `kind` / `resolution` / 包络 / `point_count` / 平移与旋转三项 / `points_json`。

**把 smap 的 2D 点云存成激光层**：`POST /api/maps/:id/laser/smap`（multipart，文件字段 file），解析只认 `header.mapName` 与 `normalPosList`，写入 `rcs_map_laser`（品牌 SEER、类型 pointcloud）。

---

## 16. 地图包与下发

**MapPackageInfo 字段**（一份地图包的当前版）：

| 字段 | 说明 |
|---|---|
| map_code / brand / format | 地图编号、品牌、包格式（`smap` 仙工单文件 / `hik-json` 海康单文件 / `huarui-zip` 华睿目录包打 zip） |
| version | 包版本号（后端自增，对应目录里的 `v<n>`） |
| artifact_id / document_id / revision | 制品编号 `<地图编号>#<品牌>#v<n>`、控制面文档域文档编号 `<地图编号>#<品牌>`、文档域修订号（未启用文档域时为 0） |
| file_path / file_name / sha256 / size_bytes | 对外相对路径（形如 `/static/mapdocs/MAP-01/SEER/v3/promise-cp.smap`）、文件名、内容校验值、字节数 |
| summary_json / warnings | 生成摘要（点数、边数、区域数、激光点数、警告等）与可用性提示 |
| updated_at | 最近一次生成时间 |

| 接口 | 说明 |
|---|---|
| POST /api/maps/:id/generate-package?brand= | 按品牌生成一份可下发的包。`brand` 必填（缺失 → 40001），取 SEER / HIK / HUARUI。文件按 `data/mapdocs/<map_code>/<brand>/v<n>/` 归档，当前版写 `rcs_map_package`，每生成一版写一行 `rcs_map_package_version` |
| GET /api/maps/:id/packages | 取该图全部品牌的当前版（`packages`）与版本台账（`versions`，元素字段 `brand` / `version` / `format` / `file_path` / `sha256` / `size_bytes` / `created_at`） |
| POST /api/maps/:id/deploy?brand= | 把该品牌当前版推给车体或厂商平台。通道按品牌在配置 `MapDeploy` 段给（URL / 方法 / 鉴权头 / 表单字段名 / 超时），未配置时不下发、状态返回 `SKIPPED` 并在 message 里写明「未配置下发通道，文件可直接从 file_path 下载」；没有生成过该品牌的包 → 40001「请先保存拓扑（保存时会自动生成）」。每次下发都写一条 `rcs_map_deploy` 记录 |

**下发结果（MapPackageDeployInfo）**：`status`（`SUCCESS` / `FAILED` / `SKIPPED`）/ `message`（结果说明，失败原因是上传返回内容，截断 500 字）/ `target`（配置里的车体编号或平台名）/ `brand` / `version` / `file_path`。

**自动生成**：品牌包导入成功后会自动生成一份该品牌的地图包（异步执行，失败只记日志）；画布保存不再自动生成（拓扑图没有品牌，需要哪家的可下发件就用生成接口显式指定品牌）。

---

## 17. 数据表清单

| 表名 | 用途 |
|---|---|
| rcs_map_config | 地图配置：编号、名称、楼层、快照最新地址与版本号、更新时间、第三方品牌编号映射（brand_map_codes），点线区域与版本都以地图编号挂靠本表 |
| rcs_map_point | 点位：编号（图内唯一且跨图唯一）、名称、图块类型、语义类型、坐标（毫米，可负）、准入与旋转车型、自动补充四件套、可避让绕路、可休息、点位方向、显示尺寸、排队数、站点绑定、货架归属、站点类型与高度、品牌原始属性 |
| rcs_map_line | 线段（即边）：起终点 uuid、线型、角度族（angle / in_angle / out_angle）、单双向、弯曲方向、避障方案引用、速度、准入车型、曲线控制点、前端绘制折线、品牌原始属性 |
| rcs_map_config_version | 快照版本索引：每次保存一行（版本号 + 该版本快照文件相对路径 + 保存时间），回滚定位与删图清文件用，只保留最近 10 份 |
| rcs_map_avoidance_plan | 避障方案字典：编号、名称与前 / 后 / 左 / 右四个避障距离（mm），线表的 avoidance_plan_id 引用本表 |
| rcs_map_element | 地图元素主数据：我们自己的类型编码（唯一）、类型名称、是否同步 FMS、图例、是否启用、备注，以及该类型在各品牌下的编号（brand_types） |
| rcs_map_field_dict | 品牌字段字典：品牌 + 对象类型（point / line / area）+ 字段路径一行，含中文标签、值类型、枚举候选、分组、排序、是否可编辑、样本值、来源，以及关联的自研属性字段与开关 |
| rcs_map_self_field | 我们自己的业务属性字段元数据：适用对象（点位 / 线段）、属性编码（与库里的业务列同名）、中文名、值类型、是否可在画布编辑、排序与说明 |
| rcs_map_point_alias | 点位别名留档：外部原名（smap 的 instanceName、CAD 的坐标形态编码）到库内点位编码的映射，以及别名来源 |
| rcs_map_laser | 地图激光层：一图一行，含类型（点云 / 栅格 / 二进制 / 无）、分辨率、原点与包络、点数、点云或栅格原文、渲染底图路径与校验值，以及人工调整的平移与旋转参数 |
| rcs_map_source_file | 地图源文件留档：导入包里每一个文件的分类、包内相对路径、受管目录里的路径、大小与校验值，导出时按相对路径复原目录结构 |
| rcs_map_package | 地图包当前版：一图一品牌一行，含包格式、版本号、制品编号、文档域编号与修订号、文件路径、校验值、大小与生成摘要 |
| rcs_map_package_version | 地图包版本台账：每生成一版一行（品牌、版本号、格式、文件路径、校验值、大小、摘要、生成时间），版本列表的数据源 |
| rcs_map_deploy | 地图下发记录：按地图与品牌记录每次下发的目标、版本、文件路径、校验值、状态（SUCCESS / FAILED / SKIPPED）与结果说明 |
| rcs_map_zone | 地图区域：图内一组边构成的区域，含区域编号（图内唯一）、名称、类型（库位存放区 / 临时管制区 / 禁行区 / 限速区）、限速值与说明 |
| rcs_map_zone_line | 区域与边的关联表：`(zone_id, line_id)` 主键天然去重，反向按 line_id 查这条边属于哪些区域 |
| rcs_smap_import | 仙工 smap 导入记录：一图一行，含源文件名、地图名、格式版本、分辨率、坐标平移量、原包络，以及四段内容的条数 |
| rcs_smap_element | smap 原始元素留档：库内点线表表达不了的字段（节点朝向与属性、曲线控制点、高级特征线）按元素类别与引用键原样存 JSON，导出时回填 |
| rcs_nav_map | 导航地图：编号（唯一）、关联的拓扑地图编号（唯一）、适用品牌与车型、最新版本文件路径、版本号与更新时间 |
| rcs_nav_map_version | 导航地图版本索引：每次上传或替换一行（版本号 + 文件相对路径 + 上传时间），只保留最近 10 版 |
| rcs_nav_map_grid | 导航地图的 2D 数据：smap 的 header 二维元信息与 normalPosList 栅格解析结果（地图名、类型、版本、分辨率、包络、点数与栅格原文），一行对一张导航地图 |
| rcs_map_point_type_map | 已废弃（迁移 053 起由 rcs_map_element 取代）：多品牌点位类型映射表，数据已整并进 rcs_map_element，本表仅留档不再读写 |
