# 编排服务接口文档（rcs-orchestrator）

> **一服务装四块**：业务场景模板（`rcs_scene` / `rcs_scene_notify`）、第三方地址配置（`rcs_third_party`）、车体机构档案（`rcs_mechanism_profile`）、任务组编排（`rcs_task_group` / `rcs_task`）。
> 本服务负责把一次业务请求折算成任务组与子任务；选车、规划路线、发 order 与执行由独立服务 `rcs-dispatch` 承担（见 `md/dispatch.md`）。

## 一、服务概览

### 1.1 各域职责与数据表

| 域 | 数据表 | 接口数 | 本文件位置 |
|---|---|---|---|
| 业务场景模板 | `rcs_scene`（元信息）+ 模板 JSON 写文件；`rcs_scene_notify`（通知索引） | 7 | 二、业务场景模板域 |
| 第三方地址配置 | `rcs_third_party` | 6 | 三、第三方地址域 |
| 任务组编排 | `rcs_task_group` / `rcs_task` | 5 | 四、任务组域 |
| 车体机构档案 | `rcs_mechanism_profile` | 4 | 五、车体机构档案域 |

四块由**同一个进程 `rcs-orchestrator`**（端口 9096）提供，共 22 个接口。调度执行不在本服务：本服务把子任务写成「待下发」，`rcs-dispatch` 从库里的 `rcs_task` 取走并派车（见 `md/dispatch.md`）。

### 1.2 各域怎么串起来

- **场景模板**定义"这类活怎么干"：分几段或几个动作、每段的点怎么取、什么时机通知谁
- **第三方地址**回答"通知谁"：模板只记编号，真正地址在地址簿，换 IP 不用改模板
- **车体机构档案**回答"这台车怎么动"：动作宏、DO/DI 信号、档位表等按设备类型各一份，调度按派到的车辆机型取用
- **任务组**把配方跑起来：一次业务请求 = 一个组，按模板折算成若干子任务，从「待下发」开始
- **调度执行**由 `rcs-dispatch` 承担：选车、规划路线、发 order、执行机构动作与 DO/DI，并把子任务与任务组状态回写到库里；本服务负责建组、折算子任务与取消 / 继续（见 `md/dispatch.md`）

### 1.3 通用约定

- **响应信封**：所有接口统一返回 `{code, message, data}`，`code=0` 表示成功；**业务错误也返回 HTTP 200**，前端按 `code` 判断
- **分页约定**：列表接口传 `limit`（每页条数，<=0 或 >1000 取默认 100）+ `page`（页码从 1 起；0 视为 1，负数 40001），响应 data 为 `{total, items}`
- **可空字段**：空字符串/0 表示 NULL（未填写的字段在响应中不出现）
- **跨域**：网关已开 `Access-Control-Allow-Origin: *`（当前无鉴权）

**错误码**（各域的具体原因见对应小节）：

| code | HTTP 状态 | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 40001 | 200 | 参数错误：缺必填 / 长度超限 / 枚举非法；保存模板与建任务组时还包括模板结构、枚举、出线、入口非法，引用不存在（区域 / 点位 / 载具类型编号、仓位查不到移动点位），点位与取放高度解析失败；车体机构配置结构非法 |
| 40401 | 200 | 目标不存在（场景 / 第三方配置 / 任务组 / 按主键删除车体机构档案） |
| 40901 | 200 | 冲突：场景编码已存在、第三方编号已存在、任务组号已存在、**删除仍被引用的第三方**、状态不允许的操作（终态任务组再取消、非「已暂停」的任务组调继续） |
| 50001 | 500 | 服务器内部错误 |

## 二、业务场景模板域（rcs_scene / rcs_scene_notify）

> 业务来源：一类任务的"执行配方"——分几段或几个动作、每段用哪类设备、点位怎么取、什么时机通知哪个第三方。
> 存储形态：**一张表存元信息 + 模板 JSON 原文写本地文件**（`data/scenes/{scene_code}.json`），表里只存文件相对路径 `template_url`。
> 通知索引：模板里的通知行（v1/v2 段的 `triggers[].notifies[]`、v5 动作的 `notify[]`）在保存模板时投影到 `rcs_scene_notify` 表，用于「按第三方编号反查引用」与删除第三方时的引用保护；**模板 JSON 仍是唯一数据源**，索引丢失可重启 orchestrator 自动回填。
> 保存形态：**保存即校验**——解析模板（结构、枚举、出线、入口）与引用存在性（区域 / 点位 / 载具类型编号）全部通过才写文件，任何一项不通过返回 40001 且文件保持原状。
> 操作形态：**创建与内容分离**（同地图域"先建地图、后存画布"）——创建只建元信息空壳，模板由独立接口 `PUT /api/scenes/:id/template` 单独提交。

### 模板约定（本域特有）

- **模板键名**：模板 JSON 内部一律用**后端 snake_case 命名**（前端提交前映射、拿到后映射回自己的驼峰名，字段对照见 `场景模板字段说明.md`）
- **URL 格式**：`template_url` 为**对外相对路径**（`/static/scenes/{scene_code}.json`），前端用自己的后端地址拼完整 URL 下载；后端零 IP 感知，静态模板响应带跨域头
- **保存语义**：模板覆盖式写文件（一个场景一个文件，先写临时文件再改名）；保存成功后**同步重建该场景的通知索引**（`rcs_scene_notify`，先删后插、幂等，失败照实上报可重试）；场景编码改名时**模板文件跟随改名**、**通知索引行的 scene_code 在同一事务里迁移**并刷新 `template_url`

### 表结构（rcs_scene）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | bigint 自增 | 否 | 主键（IDENTITY） |
| scene_code | varchar(64) | 否 | 场景编码（业务键，唯一；运行时按它取配方） |
| scene_name | varchar(100) | 可 | 场景名称（页面展示用） |
| handler | varchar(32) | 否 | 处理器（自由字符串 ≤32；仅存取并透传给任务组，当前不参与分派） |
| description | varchar(255) | 可 | 描述 |
| template_url | varchar(500) | 可 | 模板文件对外相对路径（如 /static/scenes/agv_feed_line.json；**空=还没配模板**） |

键：PK(id)；唯一 `uk_rcs_scene_code`（scene_code）。

> 段 / 移动点 / 触发块 / 通知 / 动作**不建子表**，全部内嵌在模板 JSON 里：编辑器整份读、整份写，段或动作的先后就是任务链顺序、点的先后就是路径顺序（顺序本身是数据），且没有任何外部实体按 id 引用它们。为解决"按第三方反查哪些场景会通知我"，另建了一张**投影索引表** `rcs_scene_notify`（保存模板时按场景重建，接口不变）—— 它只做反查与删除保护，不是数据源。

### 模板形态（三代并存，按顶层键与段内字段识别）

| 代 | 识别特征 | 形态 |
|---|---|---|
| v1 | 顶层只有 `segments[]`，段里有 `points[]` / `triggers[]` | 流程 + 取点方式：点位由场景给定，或按取点方式从请求取 |
| v2 | 顶层 `segments[]`，段里出现 `action_type` / `point_source` / `start` / `end` / `actions` 任一项 | 段 = 流程 + 动作；点位由 FMS 任务携带（`point_source=TASK`）或场景给定（`point_source=SCENE`） |
| v5 | 顶层有 `actions[]` | 动作清单：一个动作一个点位 + DO/DI 时序 + 过程通知，可配 `edges[]` 出线与 `start_at` 入口 |

同一份模板里 `actions` 与 `segments` 同时出现返回 40001（两种形态二选一）；v2 段不允许再写 `points`（两种取点方式二选一）。老模板不需要改动，按段识别继续可用。

### 字段概览

| 位置 | 关键字段 | 建任务组时怎么用 |
|---|---|---|
| 顶层 | `segments[]`（v1/v2）、`actions[]`（v5）、`edges[]`、`start_at`、`equipment_types`、`vehicle_code` | `segments` 与 `actions` 二选一形成有序条目，一条段或一条动作生成一条子任务；`edges` 与 `start_at` 决定分支与入口；`equipment_types` 写进子任务的允许机型列表 |
| v1 段 | `seq`、`task_type`、`points[]`、`triggers[]`、`carrier`、`is_loop`、`is_continue_task` | `seq` 决定任务号后缀与 `priority`；`task_type` 写 `task_type`；`points` 解析出点位序列；`triggers` 投影进 `rcs_scene_notify` |
| v2 段 | `action_type`、`point_source`、`start`、`waypoints[]`、`end`、`actions[]` | `TASK` 来源按段序号取请求里的点位，`SCENE` 来源用场景里配好的点位；`actions` 折算成机构动作序列写 `actions` |
| v5 动作 | `action_type`、`point{source,value}`、`signals`、`signals_by_brand`、`vehicle_control`、`vehicle_control_by_brand`、`notify[]`、`node`、`next`、`on_failure`、`iface`、`is_continue_task`、`lock_vehicle`、`allow_switch_vehicle` | 一个动作一条子任务：点位按 `source` 解析，DO/DI 与控制报文写 `signals` / `vehicle_control`（含按品牌的变体），分支与出线写 `node_name` / `next_node` / `on_failure_node` / `branch_edges`，接口调用写 `iface`，过程通知写 `notify` |
| 点位与高度 | v1 的 `point_type` / `point_value`；v5 的 `point.source` / `point.value` / `pick_mode`；请求里的位置类型 `08` 站点 / `09` 仓位 | `fixed` 直取、`interface` 按字段名从请求取、`previousPoint` 沿用上一个已解析的点；v5 的 `area` / `previousRelated` / `nextRelated` 建组时查区域与关联点，折成具体点位；取放高度由 RCS 按「仓位 + 货架层 + 载具类型」算出后写 `start_height_mm` / `end_height_mm` 与来源列 |

每个字段的类型、取值、必填与报错文案见 `C:\Users\chenpeng\develop\workspace\doc\doc\场景模板字段说明.md`（全字段字典）。

### 完整示例：一个 v1 形态的场景（产线送料）

下面用一个 v1 形态的场景（老模板继续可用）走一遍：从建第三方地址到建任务组生成子任务。

#### ① 先建第三方地址（模板的通知行要按编号引用它）

```
POST /api/third-parties
{"third_party_code":"ICAL","name":"立库系统","ip":"10.61.2.13","port":7000,"base_path":"/ics"}
```

#### ② 建场景（只建元信息空壳，不含模板）

```
POST /api/scenes
{"scene_code":"PL-FEED","scene_name":"产线送料","handler":"default_handler","description":"取框→送产线"}
```

#### ③ 保存模板（`PUT /api/scenes/{id}/template`，**body 就是下面整份 JSON 原文**）

```json
{
  "segments": [
    {
      "seq": 1,                                                  // 第 1 段 = 第 1 个子任务
      "task_type": "PICK_TASK",                                  // RCS 任务类型 → rcs_task.task_type
      "device_type": 2116,                                       // 设备类型（不校验、不参与折算）
      "is_loop": false,                                          // 该段是否循环（透传写库，当前不参与派单）
      "is_continue_task": true,                                  // 跑完是否继续下发后续子任务
      "carrier": {"type": "vehicleType", "value": "12", "interface_type": ""},
      "points": [
        {"seq": 1, "point_type": "interface", "point_value": "startLocation", "station_action": "none"},
        {"seq": 2, "point_type": "fixed", "point_value": "A-001", "station_action": "bind",
         "auto_wait": true, "wait_area": "WAIT-1"}
      ],
      "triggers": [
        {"trigger_type": "start", "carrier_action": "bind",
         "notifies": [{"third_party_code": "ICAL", "method": "TAKE", "post_path": "/ics/take"}]},
        {"trigger_type": "end", "carrier_action": "none", "notifies": []}
      ]
    },
    {
      "seq": 2,
      "task_type": "PUT_TASK",
      "device_type": 2116,
      "is_loop": false,
      "is_continue_task": false,                                 // 本段是最后一段，组内已无后续子任务，不会挂起
      "carrier": {"type": "interface", "value": "vehicleCode", "interface_type": ""},
      "points": [
        {"seq": 1, "point_type": "fixed", "point_value": "A-001", "station_action": "unbind"},
        {"seq": 2, "point_type": "interface", "point_value": "endLocation", "station_action": "none"}
      ],
      "triggers": [
        {"trigger_type": "outbin", "carrier_action": "none",
         "notifies": [{"third_party_code": "ICAL", "method": "LEFT_SLOT", "post_path": "/ics/left-slot"}]},
        {"trigger_type": "end", "carrier_action": "unbind",
         "notifies": [{"third_party_code": "ICAL", "method": "FINISH", "post_path": "/ics/finish"}]}
      ]
    }
  ]
}
```

#### ④ 用这个场景建任务组

```
POST /api/task-groups/PL-FEED
{"task_group_code":"TG-DEMO-1","vehicle_code":"VEH001",
 "start_location":"S0","end_location":"B-02","req_code":"WMS-001"}
```

#### ⑤ 折算出的子任务（一段一条，字段怎么算出来的）

| 子任务 | task_type | start_location | end_location | waypoint | priority |
|---|---|---|---|---|---|
| `TG-DEMO-1-1`（段 1） | `PICK_TASK` | `S0` ← 点 1 是 `interface`+`startLocation`，取**请求的** `start_location` | `A-001` ← 点 2 是 `fixed`，直取 `point_value` | `S0,A-001` | `1` |
| `TG-DEMO-1-2`（段 2） | `PUT_TASK` | `A-001` ← 点 1 是 `fixed` | `B-02` ← 点 2 是 `interface`+`endLocation`，取**请求的** `end_location` | `A-001,B-02` | `2` |

同时，模板里的 3 条通知会被投影进 `rcs_scene_notify`（场景 `PL-FEED`、编号 `ICAL` 共 3 行：段 1 的 `start`、段 2 的 `outbin` 与 `end`）—— 这就是"按第三方编号反查引用"和"删除第三方时引用保护"的依据。

模板字段与子任务列的完整对应见上文「字段概览」与 `C:\Users\chenpeng\develop\workspace\doc\doc\场景模板字段说明.md`（全字段字典）。

### 接口总览（7 个）

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/scenes | 创建业务场景（**只建元信息空壳，不含模板**） |
| GET | /api/scenes | 场景列表（分页 + 编码/名称模糊过滤） |
| GET | /api/scenes/by-code/:scene_code | 按场景编码取场景（运行态取配方，不必知道主键） |
| GET | /api/scenes/:id | 场景详情（返回模板文件路径 template_url） |
| PUT | /api/scenes/:id | 更新场景元信息（**不含模板**） |
| PUT | /api/scenes/:id/template | **保存模板**（body 为模板 JSON 原文；校验通过后写文件 + 回填 template_url + 重建通知索引） |
| DELETE | /api/scenes/:id | 删除场景（同事务删除通知索引行，并删除模板文件） |

**前端两段式流程**：① 新增场景（填编码/名称/处理器/描述）→ ② 打开模板编辑器，保存时把整份模板 JSON 提交到 `PUT /api/scenes/:id/template`；回显时用详情里的 `template_url` 下载 JSON（`template_url` 为空 = 还没配模板）。

---

### 1. 创建业务场景（只建空壳）

`POST /api/scenes`

**作用**：建一行场景元信息，**不涉及模板**（`template_url` 为空，表示"还没配模板"）。

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| scene_code | string | 是 | 场景编码（业务键，唯一，最长 64） |
| scene_name | string | 否 | 场景名称（最长 100） |
| handler | string | 是 | 处理器（自由字符串 ≤32，取值不限定；仅存取并透传给任务组） |
| description | string | 否 | 描述（最长 255） |

**响应 data**：SceneInfo（见下表，`template_url` 为空）。

```json
// 请求
POST /api/scenes
{"scene_code":"agv_feed_line","scene_name":"产线送料","handler":"default_handler","description":"取框→送产线"}

// 响应
HTTP 200
{"code":0,"message":"ok","data":{
  "id":7,"scene_code":"agv_feed_line","scene_name":"产线送料",
  "handler":"default_handler","description":"取框→送产线"}}
```

**错误场景**：缺 `scene_code`/`handler` → 40001；编码已存在 → 40901。

---

### 2. 场景列表

`GET /api/scenes`

**作用**：分页查询场景配置（按 id 升序），每行带模板文件路径。

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| scene_code | string | 否 | 场景编码模糊过滤 |
| scene_name | string | 否 | 场景名称模糊过滤 |
| limit | int | 否 | 每页条数（<=0 或 >1000 取默认 100） |
| page | int | 否 | 页码（从 1 起；0 视为 1，负数 40001） |

**响应 data**：`{total, items}`（items 为 SceneInfo 数组）。

```json
GET /api/scenes?scene_code=agv_feed_line&limit=10&page=1

HTTP 200
{"code":0,"message":"ok","data":{"total":1,"items":[
  {"id":7,"scene_code":"agv_feed_line","scene_name":"产线送料","handler":"default_handler",
   "template_url":"/static/scenes/agv_feed_line.json"}]}}
```

---

### 3. 按场景编码取场景

`GET /api/scenes/by-code/:scene_code`

**作用**：运行态按编码取配方（调用方不必知道主键），返回与详情一致的元信息与 `template_url`。编码不存在 → 200 + 40401。

---

### 4. 场景详情

`GET /api/scenes/:id`

**作用**：查询场景元信息与模板文件路径；前端据此下载模板 JSON 做回显（拼自己的后端地址访问 `/static/scenes/*.json`）。

**响应 data**：SceneInfo。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 场景主键 ID（自增） |
| scene_code | string | 场景编码 |
| scene_name | string | 场景名称（可空） |
| handler | string | 处理器 |
| description | string | 描述（可空） |
| template_url | string | 模板文件对外相对路径；**空=还没配模板** |

不存在 → 200 + 40401。

---

### 5. 更新场景元信息

`PUT /api/scenes/:id`

**作用**：只覆盖元信息（**不碰模板**）。改名时的连带动作：若该场景已配过模板，**模板文件跟随改名**（旧文件重命名为新编码）并刷新 `template_url`；通知索引行的 `scene_code` 也在同一事务里迁移（避免索引悬挂）。

**通知索引随之刷新**：更新成功后，**该场景若已配模板**，会按模板重建它自己的通知索引（模板里的通知行解析出 0 行则清空该场景的索引——通知删空时索引也必须跟着空，否则反查会查出已不存在的关系、误拦第三方删除）。模板读取或索引写入失败**只告警、不阻断更新**（索引是派生数据，缺的靠"再保存一次模板"或服务启动回填补齐）。

**路径参数**：id（必填）；**请求体**：同创建（scene_code / handler 必填）。

**响应 data**：SceneInfo（更新后的完整行）。

**错误场景**：缺 `scene_code`/`handler` → 40001；编码与其他场景重复 → 40901；场景不存在 → 40401。

---

### 6. 保存模板

`PUT /api/scenes/:id/template`

**作用**：模板编辑器的保存按钮。**body 就是整份模板 JSON 原文**（不是 `{"template": ...}` 外壳，也不带任何元信息），上限 1MB，网关按原始 body 读取，写进文件的就是请求原文。服务端依次执行：

1. 解析模板：形态识别（`actions` 与 `segments` 二选一）、结构、枚举；v5 还包括出线（`edges[]` 的来源与目标节点存在、只允许向后连、同一节点的同一触发条件只能有一条线）与入口（`start_at` 必须是模板里存在的节点名）
2. 引用存在性：区域编码查 `rcs_area`；点位编码先做历史编码规范化（CAD 导入图的编码形如 `000604,000282`，规范形为 `X000604Y000282`），再经 mapx 的 `MissingPointCodes` 校验；载具类型编号查 `rcs_carrier_type`
3. 覆盖写 `data/scenes/{scene_code}.json`（先写临时文件再改名，写入请求原文）
4. 回填 `template_url`
5. 按模板重建该场景的通知索引（`rcs_scene_notify`：先删后插、幂等；v1/v2 段取 `triggers[].notifies[]`，v5 取动作的 `notify[]`，第三方编号为空的行不入索引）

任一步不通过都返回 40001，模板文件与通知索引保持原状。

**路径参数**：id（必填）；**请求体**：模板 JSON 对象（结构与示例见上文，全字段见 `场景模板字段说明.md`）。

**响应 data**：SceneInfo（含最新 `template_url`）。

```json
// 请求（body 即模板原文）
PUT /api/scenes/7/template
{"version":5,"actions":[
  {"seq":1,"action_type":"MOVE","point":{"source":"fixed","value":"A-001"},
   "node":"取货点位","is_continue_task":true}]}

// 响应
HTTP 200
{"code":0,"message":"ok","data":{
  "id":7,"scene_code":"agv_feed_line","scene_name":"产线送料","handler":"default_handler",
  "template_url":"/static/scenes/agv_feed_line.json"}}
```

**错误场景**：

| 场景 | 响应 |
|---|---|
| 场景不存在 | 200 + 40401 |
| body 非合法 JSON / 结构或枚举非法 / 出线或入口非法 | 200 + 40001（报文带"第几段 / 第几个动作 / 第几条线"） |
| 模板引用的区域不存在 | 200 + 40001 |
| 模板引用的点位不存在，或点位编码无法规范化 | 200 + 40001 |
| 模板引用的载具类型编号不存在 | 200 + 40001 |
| 模板文件写不进去（磁盘、权限） | 500 + 50001 |

---

### 7. 删除场景

`DELETE /api/scenes/:id`

**作用**：在一个事务里删除场景记录与它的通知索引行，并删除其模板文件（按库中 `template_url` 定位；文件清理失败仅告警，不影响删除结果）。删完后该场景引用过的第三方就不再有引用、可以删除了。

**响应**：`{code: 0, message: "ok"}`；不存在 → 200 + 40401。

---

### 附：与旧后端（Java）的差异（场景模板域）

| Java（`sfms_agv_task_type`） | 本服务（`rcs_scene`） | 原因 |
|---|---|---|
| 创建与模板**同一次请求**提交 | 创建只建元信息，模板走独立接口 | 与地图域"先建地图、后存画布"同构；编辑器与列表是两个页面动作 |
| 一张表 + `template_content` text 列 | 元信息入表，模板 JSON 写文件 + 表存 `template_url` | 列表查询不背大字段（Java 的分页查询会把整份模板一起查出来），文件走静态服务可缓存 |
| 模板 JSON 是数组（`[{...段...}]`） | 对象（`{"segments":[...]}` 或 `{"actions":[...]}`） | 顶层可扩展：版本、动作清单、出线、入口都放在顶层 |
| 键名驼峰（`taskType` / `pointFullList` / `notifyList`） | 键名下划线（`task_type` / `points` / `triggers`） | 与后端接口字段风格统一，前端做一次映射 |
| `scene` 无唯一约束（历史数据存在重复场景码） | `scene_code` 唯一索引 | 运行时靠场景编码取配方，重复必然踩坑 |
| `id` 由前端传入（`IdType.INPUT`，不传插不进） | 自增 identity | 消除"前端忘传 id 保存失败" |
| 保存零校验，运行时才报错（如"不支持的点位获取方式"） | 保存即校验：结构、枚举、出线、入口与引用存在性（区域 / 点位 / 载具类型编号）都通过才写文件 | 配置错在保存那一刻暴露，报错带段 / 点 / 线定位；建组时再校验一次取值 |
| 两对绑定/解绑布尔，双开时 `else if` 只执行绑定 | 各合并为一个三值枚举字段 | 非法态（同点双标、双开）从结构上消失 |
| `handler` 列混入中文名与不存在的 code（脏数据） | 必填 + ≤32 字符，**取值不限定**（原样入库） | 分派逻辑尚未接入，暂不限定取值 |
| `area_code`/`equipment_type`/`monitor`/`report_status`/`notify_third`/`third_status` 六个字段 | 暂不迁移 | 新页面（`/SFMS/TaskTemplate/*`）的写库语句本身也不写这些列，属旧页面遗留 |
| 无启停字段 | 无启停（下线即删除） | 按需求确认，不引入额外状态 |
| 通知配置另存独立表 `sfms_scene_rcs_notify_third`（scene + 方法 + 编号，**没有 post_path**），运行态读的却是模板里的 `notifyList` | 通知只存模板 JSON（v1/v2 段的 `triggers[].notifies[]`、v5 动作的 `notify[]`），另建**投影索引表** `rcs_scene_notify`（带段序号 / 触发阶段 / post_path），保存模板时按场景重建 | 保留"整份编辑整份保存"的编辑器模型，同时拿到可反查、可做引用保护的索引 |

**后续（本期不做）**：点位冻结、策略配置表（Java 的 `sfms_scene_strategy_config`）；`device_type` 的存在性校验。如需历史版本回退，再加版本表或 `template jsonb` 副本列即可（接口不变）。下发车辆、执行机构动作与通知第三方由 `rcs-dispatch` 承担（见 `md/dispatch.md`）；建组折算见本文件「四、任务组域」。

## 三、第三方地址域（rcs_third_party）

> 作用：业务场景模板的通知行只记"第三方编号 + 接口路径"，真正的系统地址（IP/端口/基础路径）在这里维护。
> 运行态拼 URL：`http://{ip}:{port}{base_path}{模板里的 post_path}`
> 引用关系：模板通知行按 `third_party_code` 引用本表；保存模板时通知行会投影到 `rcs_scene_notify`，用于反查引用与删除保护（模板 JSON 仍是唯一数据源）。

### 表结构（rcs_third_party）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | bigint 自增 | 否 | 主键（IDENTITY） |
| third_party_code | varchar(64) | 否 | 第三方编号（业务键，唯一；模板 `notifies[].third_party_code` 引用它，**不可改**） |
| name | varchar(100) | 可 | 名称（页面展示用） |
| ip | varchar(64) | 可 | IP 或域名 |
| port | integer | 可 | 端口（0=未设置） |
| base_path | varchar(128) | 可 | 基础路径（如 `/ics`、`/fms/`） |

键：PK(id)；唯一 `uk_rcs_third_party_code`（third_party_code）。

**与模板的引用关系**：模板通知行长这样 ——

```json
{"third_party_code":"AGV","method":"66","post_path":"/SFMS/public/api/agv/callEmptyContainer"}
```

其中 `third_party_code` 就是本表的业务键。运行态按它查出 `ip/port/base_path`，加上模板里的 `post_path` 拼成完整地址后 POST 出去，形如 `http://10.61.2.13:7000/ics/SFMS/public/api/agv/callEmptyContainer`：`ip:port` 与本表的 `base_path` 来自本表，路径后缀来自模板里的 `post_path`。

### 接口总览（6 个）

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/third-parties | 创建第三方配置（编号必填唯一） |
| GET | /api/third-parties | 列表（分页 + 编号/名称模糊过滤） |
| GET | /api/third-parties/:id | 详情 |
| PUT | /api/third-parties/:id | 更新 `name/ip/port/base_path`（**编号不可改**） |
| DELETE | /api/third-parties/:id | 删除（**被场景通知引用时拒绝**） |
| GET | /api/third-parties/:code/scene-refs | 反查引用：被哪些场景的哪一段、哪个触发阶段引用 |

---

### 1. 创建第三方配置

`POST /api/third-parties`

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| third_party_code | string | 是 | 第三方编号（业务键，唯一，最长 64） |
| name | string | 否 | 名称（最长 100） |
| ip | string | 否 | IP 或域名（最长 64） |
| port | int | 否 | 端口（0~65535，0=未设置） |
| base_path | string | 否 | 基础路径（最长 128，如 `/ics`） |

```json
// 请求
POST /api/third-parties
{"third_party_code":"AGV","name":"AGV 调度系统","ip":"10.61.2.13","port":7000,"base_path":"/ics"}

// 响应
HTTP 200
{"code":0,"message":"ok","data":{
  "id":1,"third_party_code":"AGV","name":"AGV 调度系统",
  "ip":"10.61.2.13","port":7000,"base_path":"/ics"}}
```

**错误场景**：缺 `third_party_code` / 端口越界 / 字段超长 → 200 + 40001；编号已存在 → 200 + 40901。

---

### 2. 第三方配置列表

`GET /api/third-parties`

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| third_party_code | string | 否 | 第三方编号模糊过滤 |
| name | string | 否 | 名称模糊过滤 |
| limit | int | 否 | 每页条数（<=0 或 >1000 取默认 100） |
| page | int | 否 | 页码（从 1 起；0 视为 1，负数 40001） |

**响应 data**：`{total, items}`。

```json
GET /api/third-parties?third_party_code=AGV&limit=10&page=1

HTTP 200
{"code":0,"message":"ok","data":{"total":1,"items":[
  {"id":1,"third_party_code":"AGV","name":"AGV 调度系统",
   "ip":"10.61.2.13","port":7000,"base_path":"/ics"}]}}
```

---

### 3. 第三方配置详情

`GET /api/third-parties/:id`

**路径参数**：id（必填，主键）

**响应 data**：第三方配置对象；不存在 → 200 + 40401。

---

### 4. 更新第三方配置

`PUT /api/third-parties/:id`

**作用**：按主键定位，覆盖 `name / ip / port / base_path`（空串/0 = 清空为 NULL）。
**第三方编号不可改** —— 它是模板通知行引用的业务键（与 `agv_code` 同理），改编号会让存量模板的引用指空。

**请求体**：同创建（不含 `third_party_code`）。**响应 data**：更新后的完整行。

**错误场景**：目标不存在 → 40401；端口越界 → 40001。

---

### 5. 删除第三方配置

`DELETE /api/third-parties/:id`

**作用**：删除配置；不存在 → 200 + 40401。

**引用保护**：仍被场景模板通知行引用时**拒绝删除**，返回 200 + 40901 并给出引用条数：

```json
DELETE /api/third-parties/10

HTTP 200
{"code":40901,"message":"state conflict: 第三方 AGV 被 2 处场景通知引用，请先在场景模板里解除引用"}
```

判断依据是投影表 `rcs_scene_notify`（保存模板时按场景重建，见本文件「二、业务场景模板域」），实现是一条带 `NOT EXISTS` 守卫的 `DELETE`：检查与删除在同一条语句里完成，避免检查与删除之间插入新引用（与地图域避障方案的删除保护同一套路）。

**解除引用的办法**：在场景模板编辑器里删掉该第三方的通知行（或改成别的编号）并保存，索引随之更新；也可以先调第 6 节的反查接口看被谁引用。

---

### 6. 按第三方编号反查引用

`GET /api/third-parties/:code/scene-refs`

**作用**：删除前自查 —— 这个第三方被哪些场景的哪一段、哪个触发阶段引用。数据来自投影表 `rcs_scene_notify`。

**路径参数**：`code` = 第三方编号（业务键，不是主键 id）。编号不存在时返回空列表（不报 40401 —— 本接口查的是"引用关系"，不是配置本身）。

**响应 data**：`{total, items}`，items 为引用位置：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 通知行主键（rcs_scene_notify.id） |
| scene_code | string | 场景编码 |
| scene_name | string | 场景名称（可空） |
| segment_seq | int | 段序号或动作序号（从 1 起） |
| trigger_type | string | 触发阶段（start 开始 / outbin 走出储位 / end 完成） |
| method | string | 第三方侧方法名（可空） |
| post_path | string | 接口路径（可空） |

```json
GET /api/third-parties/AGV/scene-refs

HTTP 200
{"code":0,"message":"ok","data":{"total":2,"items":[
  {"id":1,"scene_code":"agv_feed_line","scene_name":"产线送料","segment_seq":1,
   "trigger_type":"start","method":"66","post_path":"/SFMS/public/api/agv/callEmptyContainer"},
  {"id":2,"scene_code":"agv_feed_line","scene_name":"产线送料","segment_seq":2,
   "trigger_type":"end","method":"FINISH","post_path":"/SFMS/public/api/agv/finish"}]}}
```

> 行数上限 500（正常引用只有几条），`total` 始终是完整引用条数；同一场景同一段+阶段+编号出现多次会各占一行（与模板里的通知行一一对应）。

---

### 附：与旧后端（Java）的差异（第三方地址域）

| Java（`sfms_third_party_configuration`） | 本服务（`rcs_third_party`） | 原因 |
|---|---|---|
| 主键即 `third_party_code`（业务键当主键） | 自增 `id` 主键 + `third_party_code` 唯一 | 与 agv/map/scene 域一致：业务键唯一、主键自增 |
| 7 列：上面 4 列 + `user_name` / `password` / `api_key` | 只建 4 列（+ name） | Java 那三列**全项目零引用**（数据也全 NULL），实际认证走的是代码里固定写好的请求头（`X-lr-appkey` 的值还是占位符）。等对接方明确认证方式再加 |
| 无 `name` 列 | 加 `name` | 页面展示需要 |
| 表格里的 `port` 是 int | `port integer`（可空，0=未设置） | 同 Java |
| CRUD 走聚合端点 `/SFMS/ThirdPartyConfiguration/`（`operationCode` 分派） | 5 个 RESTful 接口 | 项目统一风格 |
| 查询成功分支漏返回数据（`Result.success()` 没带 list） | 正常返回 `{total, items}` | 修正 |

**后续（本期不做）**：按本表拼 URL 并 POST 通知的调用方是 `rcs-dispatch`（见 `md/dispatch.md`）；通知留痕表（Java 的 `sfms_feedback_record`，其重试机制在旧系统里已无调用方）；认证字段（Java 配置表里的 `user_name` / `password` / `api_key`，全项目零引用且数据全 NULL）。

## 四、任务组域（rcs_task_group / rcs_task）

> 业务定位：**一次业务请求 = 一个任务组**。任务组按业务场景模板（`rcs_scene`）折算成若干子任务，写成「待下发」；选车、规划路线、发 order 与执行由 `rcs-dispatch` 承担（见 `md/dispatch.md`）。

### 表结构

#### rcs_task_group —— 任务组（19 列）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | bigint 自增 | 否 | 主键（IDENTITY） |
| task_group_code | varchar(64) | 否 | 任务组号（业务键，唯一；请求不带则由后端生成 `TG+时间戳`） |
| scene_code | varchar(64) | 可 | 业务场景编码（按业务键引用 `rcs_scene.scene_code`） |
| handler | varchar(32) | 可 | 处理器（取自场景，随建组透传） |
| status | varchar(16) | 否 | 状态（中文枚举，见下） |
| vehicle_code | varchar(64) | 可 | 载具编号 |
| start_location / waypoints / end_location | varchar(128) / text / varchar(128) | 可 | 起点 / 途经点（英文逗号分隔）/ 终点 |
| current_location | varchar(128) | 可 | 当前位置（运行态回填） |
| priority | integer | 可 | 跨组优先级（0=未设置） |
| agv_code | varchar(64) | 可 | AGV 编号（运行态回填；锁车态下=锁定给本组的车） |
| vehicle_locked | boolean | 否 | 是否处于锁车态（动作配了 `lock_vehicle` 时派定车后置位；组到终态或取消自动失效），默认 false |
| extra | jsonb | 可 | 扩展信息（JSON 原文） |
| field_context | jsonb | 可 | 任务组字段上下文（接口响应取出的字段与车端字段，键为 `节点名.字段名` / `agv.xxx`） |
| vehicle_conf | jsonb | 可 | 车体配置快照（按机型的整车参数与动作序列；调度派车后按执行车体的设备类型取用。当前建组流程不写入这一列） |
| created_at / started_at / finished_at | timestamptz | 否 / 可 / 可 | 创建 / 开始（首个任务下发或组挂起时回填）/ 结束（终态回填） |

键：PK(id)；唯一 `uk_rcs_task_group_code`；索引 `idx_rcs_task_group_scene_code`、`idx_rcs_task_group_status`。

#### rcs_task —— 子任务（47 列）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | bigint 自增 | 否 | 主键（IDENTITY） |
| task_code | varchar(64) | 否 | 任务单号（业务键，唯一；`组号-序号`） |
| task_group_code | varchar(64) | 否 | 所属任务组号 |
| task_type | varchar(64) | 可 | RCS 任务类型（取自模板段的 `task_type`） |
| status | varchar(16) | 否 | 状态（中文枚举） |
| start_location / end_location | varchar(128) | 可 | 起点 / 终点 |
| waypoint | text | 可 | 路径点串（点位序列按顺序逗号连接，如 `S0,A-001,B-02`；无类型后缀） |
| vehicle_code | varchar(64) | 可 | 载具编号 |
| current_location | varchar(128) | 可 | 当前位置（运行态回填） |
| agv_code | varchar(64) | 可 | AGV 编号（运行态回填） |
| priority | integer | 否 | 组内优先级（下发顺序，取自模板段或动作的序号，从 1 起） |
| start_floor / end_floor | integer | 可 | 楼层（对接多楼层调度时用） |
| elevator_code | varchar(64) | 可 | 电梯编号 |
| req_code | varchar(64) | 可 | 上层请求编号（原样带回） |
| map_code | varchar(64) | 可 | 任务所属地图编号（带值时调度校验任务图与车挂的图一致） |
| created_at | timestamptz | 否 | 创建时间 |
| started_at / finished_at | timestamptz | 可 | 开始 / 结束时间 |
| action_type | varchar(16) | 可 | 段动作类型：MOVE 移动 / PICK 取货 / DROP 放货（空=老模板段，按纯移动处理） |
| point_source | varchar(16) | 可 | 段点位来源：TASK 由 FMS 任务携带 / SCENE 场景里固定配置 |
| start_height_mm / end_height_mm | integer | 可 | 段起点 / 终点事件的取放高度（毫米） |
| start_height_source / end_height_source | varchar(16) | 可 | 高度来源（FMS_OVERRIDE / POINT / RACK_LEVEL / TYPE_LEVEL / LOCATION_TYPE / BEAM_OFFSET） |
| carrier_type_code | varchar(64) | 可 | 载具类型编号（FMS 的载具类型编码） |
| equipment_types | jsonb | 可 | 允许的设备类型列表（空=不限机型） |
| actions | jsonb | 可 | 段机构动作序列（`at` + `type` + `height_mm` / `position`，顺序即执行顺序） |
| is_loop | boolean | 可 | 段是否循环（既有语义，透传写库） |
| is_continue_task | boolean | 可 | 段跑完是否继续下发后续子任务（false 且组内还有未完成子任务时组挂起为「已暂停」） |
| last_error | text | 可 | 失败原因（调度执行失败时回写） |
| control_method / control_conf | varchar(16) / jsonb | 可 | 通讯控制方式与第三方调度参数；动作一律走 VDA，建组不写入这两列（空=按 VDA 处理） |
| signals | jsonb | 可 | 动作的 DO/DI 时序（按分组有序或并行，`require`=是否需要满足触发） |
| signals_by_brand | jsonb | 可 | 按品牌的 DO/DI 时序（品牌 → 信号数组；没配的品牌改用 `signals`） |
| vehicle_control | jsonb | 可 | 车体控制（默认那份）：`{method, topic, body}` |
| vehicle_control_by_brand | jsonb | 可 | 按品牌的车体控制（品牌 → 配置） |
| node_name / next_node / on_failure_node | varchar(64) | 可 | 节点名，以及成功 / 失败后跳到的节点名 |
| branch_edges | jsonb | 可 | 本节点的出线数组（每条线自带 `when` 触发条件与 `to` 目标节点名） |
| iface | jsonb | 可 | 节点上的接口调用配置（method / url / headers / body / fields） |
| notify | jsonb | 可 | 执行过程通知（`trigger_type` + `third_party_code` + `api` / `method` / `post_path`） |
| feedback | jsonb | 可 | 任务反馈配置（遗留列，当前不写入） |
| lock_vehicle / allow_switch_vehicle | boolean | 可 | 锁定车 / 任务换车（动作级开关） |

键：PK(id)；唯一 `uk_rcs_task_code`；索引 `idx_rcs_task_group_code`、`idx_rcs_task_status`、`idx_rcs_task_group_node`（`task_group_code, node_name`）。

### 状态机（中文枚举，作为接口约定固定）

| 状态 | 含义 |
|---|---|
| 已创建 | 枚举里保留的取值；当前建组与折算在同一事务里完成，子任务直接写「待下发」，不经过此态 |
| 待下发 | 已生成子任务，等 `rcs-dispatch` 取走 |
| 待执行 | 子任务：已发给车、车还没开始跑；任务组：有子任务在推进，但没有车正在跑 |
| 执行中 | 车已开始执行 |
| 已暂停 | **非终态挂起**：本段动作配了 `is_continue_task=false` 且组内还有后续子任务时，调度把任务组挂起，后续子任务留在「待下发」不再派发，等继续接口放行 |
| 已完成 / 已取消 / 失败 | **终态**，禁止再流转（对终态任务组再调取消 → 40901） |
| 已跳过 | **子任务专用**：分支跳变跨过的节点、`start_at` 入口之前的节点；终态，不派发、不阻塞组收尾 |

> 状态用中文枚举：库里直读直懂、页面无需字典翻译。状态一旦上线即视为接口约定，改文案 = 改数据。

### 编排与调度分工

**建组（本服务）**：

```
① POST /api/task-groups/:scene_code → 按场景编码取场景配置与模板文件
② 模板统一成有序条目：v5 一个动作一条，v1/v2 一个任务段一条
③ 折算出点位序列、段级字段、机构动作、DO/DI、车体控制、过程通知与出线
④ 任务组与全部子任务在同一事务里写入，子任务状态【待下发】（start_at 之前的节点写【已跳过】）
```

**派车执行（`rcs-dispatch`，见 `md/dispatch.md`）**：

```
⑤ 取【待下发】，按「组内串行」（只取本组最靠前的未完成子任务）与「组是否已暂停」过滤
⑥ 选车 → 规划路线 → 发 order：子任务置【执行中】并回填车号、当前位置与时间戳
⑦ 到点后执行机构动作与 DO/DI，按任务的 notify 配置通知第三方
⑧ 收尾回写子任务状态并推进任务组：组内子任务全部终态（「已跳过」算处理完）→ 组收尾为【已完成】；
   本段配了 is_continue_task=false 且组内还有后续子任务 → 组置【已暂停】，后续子任务留在【待下发】
```

**取消（本服务）**：组内未完成的子任务全部置【已取消】，组置【已取消】并回填结束时间；终态组不允许再取消。
**继续（本服务）**：只有【已暂停】的组能继续 → 组置【待执行】，后续子任务仍按【待下发】被调度取走。

> 派发不在本服务：`internal/scheduler` 与 `internal/dispatch` 的占位实现已停用，派发统一由 `rcs-dispatch` 负责（见 `md/dispatch.md`）。

### 接口（5 个，前缀 `/api`）

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/task-groups/:scene_code | 建任务组（按场景模板折算子任务），返回详情 `{group, tasks}` |
| GET | /api/task-groups | 任务组列表（组号模糊；场景、状态精确；分页） |
| GET | /api/task-groups/:id | 任务组详情（组 + 子任务列表） |
| POST | /api/task-groups/:id/cancel | 取消任务组（级联未完成子任务） |
| POST | /api/task-groups/:id/continue | 继续任务组（把「已暂停」的组放行） |

---

### 1. 建任务组

`POST /api/task-groups/:scene_code`

**路径参数**：`scene_code`（必填）：业务场景编码，一个业务场景一个地址。

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_group_code | string | 否 | 任务组号（空则由后端生成 `TG+yyyyMMddHHmmss+微秒`） |
| vehicle_code | string | 否 | 载具编号 |
| vehicle_type | string | 否 | 载具类型（模板 `interface` 取参字段 `vehicleType` 取这里） |
| start_location | string | 否 | 组级起点（段的点位来源为 TASK 且该段没给点位时的兜底） |
| waypoints | string | 否 | 组级途经点（英文逗号分隔） |
| end_location | string | 否 | 组级终点 |
| priority | int | 否 | 跨组优先级（组的；0=未设置，数值越小越先下发） |
| req_code | string | 否 | 上层请求编号（原样带回） |
| map_code | string | 否 | 任务所属地图编号（带值时调度校验任务图与车挂的图一致） |
| segments | array | 否 | **按段的点位覆盖**，见下表 |

**`segments[]` 每项**：

| 字段 | 类型 | 说明 |
|---|---|---|
| seq | int | 段序号（与模板里的段或动作序号对应；超出模板条目数 → 40001） |
| start_location / end_location | string | 本段起点 / 终点 |
| waypoints | string | 本段途经点（英文逗号分隔） |
| start_location_type / end_location_type | string | 位置类型：`08` 站点（值就是地图点位编码）/ `09` 仓位（值是仓位号，编排侧按只读投影折成移动点位与高度解析目标）；空按 `08` 处理，其它值 40001 |
| carrier_type_code | string | 载具类型编号（FMS 编码） |
| pick_height_mm / drop_height_mm | int | 已废弃：取放高度改由 RCS 按仓位 / 货架 / 载具配置计算，传非 0 值直接 40001 |

点位取值规则：模板段 `point_source=TASK` 时用该段点位（该段没给时退回组级起终点）；`point_source=SCENE` 时用模板里配好的点位，请求不参与。组级 `start_location` / `end_location` 没给时，退回第一段 / 最后一段解析出的起终点。

**响应 data**：`{group, tasks}`（组 + 子任务数组，前端主表与明细一次拿全）。

```json
// 请求
POST /api/task-groups/agv_feed_line
{"task_group_code":"TG-DEMO-1","vehicle_code":"VEH001","map_code":"MAP-1","req_code":"WMS-001",
 "segments":[{"seq":1,"start_location":"A-01","end_location":"LM11","start_location_type":"08","end_location_type":"08"},
             {"seq":2,"start_location":"LM11","end_location":"B-02","start_location_type":"08","end_location_type":"08"}]}

// 响应
HTTP 200
{"code":0,"message":"ok","data":{
  "group":{"id":1,"task_group_code":"TG-DEMO-1","scene_code":"agv_feed_line",
           "handler":"default_handler","status":"待下发","start_location":"A-01","end_location":"B-02",
           "vehicle_code":"VEH001","priority":0,"created_at":"2026-10-06T19:13:34.061+08:00"},
  "tasks":[
    {"task_code":"TG-DEMO-1-1","task_group_code":"TG-DEMO-1","task_type":"PICK_TASK","status":"待下发",
     "start_location":"A-01","end_location":"LM11","waypoint":"A-01,LM11","priority":1,
     "action_type":"PICK","point_source":"TASK","map_code":"MAP-1"},
    {"task_code":"TG-DEMO-1-2","task_group_code":"TG-DEMO-1","task_type":"PUT_TASK","status":"待下发",
     "start_location":"LM11","end_location":"B-02","waypoint":"LM11,B-02","priority":2,
     "action_type":"DROP","point_source":"TASK","map_code":"MAP-1"}]}}
```

> 响应里的 `tasks` 是**刚折算出来的计划**（还没从库里回读），所以不带 `id` 与 `created_at` 这类库生成字段（网关侧 `omitempty` 省略）；需要真实 id 时按组 id 调详情接口 `GET /api/task-groups/:id`。`group` 是插入后 `RETURNING *` 拿回的真实行，`id`/`created_at` 都有值。

**错误场景**：

| 场景 | 响应 |
|---|---|
| 路径上的 scene_code 为空 / 字段超长 / 请求 segments 的段序号超出模板条目数 | 200 + 40001 |
| 场景不存在 | 200 + 40401 |
| 场景还没配模板 / 模板文件读不到 / 模板没有动作或任务段 | 200 + 40001（报文说明原因） |
| 模板结构或取值非法（解析不过） | 200 + 40001（报文带「第几段 / 第几个动作」） |
| 点位解析不出来（取点方式尚未支持 / 取参字段名不对 / 仓位查不到移动点位 / 解析结果为空 / 段内首个点写了「沿用上一个点」） | 200 + 40001（报文带定位） |
| 载具类型编号不存在 | 200 + 40001 |
| 取放高度算不出来（用到了该高度但解析链给不出） | 200 + 40001 |
| 传了已废弃的 `pick_height_mm` / `drop_height_mm` | 200 + 40001 |
| 任务组号已存在 | 200 + 40901 |

---

### 2. 任务组列表

`GET /api/task-groups`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| task_group_code | string | 否 | 任务组号模糊过滤 |
| scene_code | string | 否 | 场景编码精确过滤 |
| status | string | 否 | 状态精确过滤（中文枚举） |
| limit / page | int | 否 | 分页（<=0 或 >1000 取默认 100；页从 1 起） |

**响应 data**：`{total, items}`（items 为任务组数组，按 id 倒序，最新在前）—— 与页面主表一致。

---

### 3. 任务组详情

`GET /api/task-groups/:id`

**响应 data**：`{group, tasks}`（**一次性带出该组全部子任务**，按 priority、id 升序）—— 与页面"展开明细"一致。
不存在 → 200 + 40401。

---

### 4. 取消任务组

`POST /api/task-groups/:id/cancel`

**作用**：组内**未完成**的子任务全部置【已取消】（已完成与已跳过的不动），任务组置【已取消】并回填结束时间；返回最新详情。挂起中的【已暂停】组也可以取消（它属于非终态）。

**错误场景**：不存在 → 40401；**已是终态**（已完成/已取消/失败）→ 200 + 40901（避免把已完成的组改成取消）。

---

### 5. 继续任务组

`POST /api/task-groups/:id/continue`

**作用**：把【已暂停】的任务组放行 —— 组置【待执行】，后续子任务仍是【待下发】，由 `rcs-dispatch` 继续派发；返回最新详情。

**前置**：只有【已暂停】的组能继续，其它状态返回 200 + 40901（报文带当前状态）；不存在 → 40401。

```json
// 请求
POST /api/task-groups/1/continue

// 响应
HTTP 200
{"code":0,"message":"ok","data":{
  "group":{"id":1,"task_group_code":"TG-DEMO-1","status":"待执行","agv_code":"AGV-01","started_at":"2026-10-06T19:20:02.113+08:00"},
  "tasks":[{"task_code":"TG-DEMO-1-1","status":"已完成"},{"task_code":"TG-DEMO-1-2","status":"待下发"}]}}
```

> 继续后组置【待执行】：待下发是建组后的初始态（子任务都还没派过），继续时组里已经有跑完的段，语义更接近"等车接下一段"。调度只认子任务状态，组状态用于对外展示与派发守卫（【已暂停】的组不派发新子任务）。

---

### 附：与旧实现（Java）的差异

| Java（`sfms_agv_task` 与三段定时器） | 本服务 + `rcs-dispatch` | 原因 |
|---|---|---|
| 无主键无索引、DDL 与代码漂移 6 个列 | 主键 + 唯一索引 + 组号索引 + 节点索引，列与代码一致 | 按任务号查询频繁，无索引要扫全表 |
| 状态数字码 + 两套常量冲突（枚举 60=失败、常量 60=取消） | 一套中文枚举 | 消除歧义，页面无需字典翻译 |
| 三段定时器（建组 / 折算 / 下发各扫一遍表） | 建组时在同一事务里折算子任务并写「待下发」；`rcs-dispatch` 只取「待下发」 | 少两段轮询，状态跃迁更直观 |
| 处理器 / 策略：按 `handler` 分派到 6 个策略类（公交车/点到区/区到点/区到区/巷道/默认） | 处理器只存取并透传；折算按模板的段与动作进行 | 策略化交给模板配置，不再按处理器分支 |
| 点位解析（区域选点、上一/下一点关联、按载具反查） | `fixed` 直取、`interface` 从请求取（含 `waypoints`）、`previousPoint` 段内沿用；v5 动作的 `area` / `previousRelated` / `nextRelated` 建组时查区域与关联点折成具体点位；`carrierCode` 与 v1 段上的这几类取点方式仍报 40001 | 取点能力按形态分批接入，配了却跑不起来的情况直接报错，不用兜底值蒙混 |
| 点位冻结、优先级链续跑（`priority+1` 链式下发）、回调推进、通知第三方 | 派车、跟车、机构动作、DO/DI、通知与状态回写都由 `rcs-dispatch` 承担 | 调度内核是与编排分开的服务（见 `md/dispatch.md`） |

**后续（下一轮）**：`carrierCode` 取点（载具与点位的绑定关系）与 v1 段上的 `area` 取点；策略配置表。

## 五、车体机构档案域（rcs_mechanism_profile）

> 用途：机型级的机构参数档案 —— 动作宏（DI/DO 电气明细）、信号字典、移动 / 取货 / 放货动作序列、高度档位表、前移、限位急停、互锁、三色灯。调度按派到的车辆机型取用（车号 → 设备类型 → 本档案），同一份业务场景模板因此可以被多家品牌的车体执行。
> 车体最基础的参数（长宽高等元数据）配在机器人类型里；结构控制归本档案。

### 表结构（rcs_mechanism_profile）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | bigint 自增 | 否 | 主键（IDENTITY） |
| equipment_type | varchar(50) | 否 | 设备类型（业务键，唯一；与车辆档案的 `equipment_type` 同名同值） |
| brand | varchar(64) | 可 | 品牌（展示用，如 SEER / HIK / HUARUI） |
| mechanism | jsonb | 可 | 机构配置 JSON 原文（actions 动作宏 / io 信号字典 / actions_template 动作序列 / height 档位表 / reach 前移 / safety 限位急停 / interlock 互锁 / lights 三色灯；空=未配置） |
| created_at | timestamptz | 否 | 创建时间 |
| updated_at | timestamptz | 否 | 最近更新时间（覆盖保存时刷新） |

键：PK(id)；唯一 `uk_rcs_mechanism_profile_equipment_type`（equipment_type）。

### 保存时的校验

`PUT /api/mechanism-profiles/:equipment_type` 先做结构校验与归一（`rpc/orchestrator/internal/logic/mechanism_validate.go`），通过后按设备类型覆盖写（不存在则新建）；任何一项不通过返回 40001，并在报文里指明哪一项：

- `mechanism` 为空串 → 写 NULL（该设备类型标记为未配置），合法
- 必须是合法 JSON 对象；`actions` / `io` / `actions_template` / `height` / `reach` / `safety` / `interlock` / `lights` 都可选
- `actions[]` 每项：`name` 非空且不重复（忽略大小写）；`do_id` / `until_di` 是整数且不小于 -1；`do_ids[]` 都是不小于 0 的整数；`fixed_hold_ms` / `timeout_ms` 非负
- `io[]` 每项：`channel` 必须是 `DI` 或 `DO`（忽略大小写）；`id` 必填且是不小于 0 的整数
- `actions_template`（移动 / 取货 / 放货的动作序列）：按 `common/actiontpl` 的规则校验，并与 `actions[].name` 交叉校验 —— 模板里引用的动作名必须在这份档案的 `actions` 里存在，名字写错在保存这一步就拦下

写库前做 JSON 紧凑化，存进 jsonb 的是紧凑原文。删除某份档案后，该设备类型的取货 / 放货段在派车执行时会明确失败并写清去哪儿补配。

### 接口（4 个，前缀 `/api`）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/mechanism-profiles | 列表（设备类型 / 品牌模糊过滤 + 分页，按设备类型升序） |
| GET | /api/mechanism-profiles/:equipment_type | 按设备类型取一份（运行时解析链同款口径） |
| PUT | /api/mechanism-profiles/:equipment_type | 覆盖保存（不存在则新建） |
| DELETE | /api/mechanism-profiles/:id | 按主键删除 |

---

### 1. 车体机构档案列表

`GET /api/mechanism-profiles`

**查询参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| equipment_type | string | 否 | 设备类型模糊过滤 |
| brand | string | 否 | 品牌模糊过滤 |
| limit / page | int | 否 | 分页（<=0 或 >1000 取默认 100；页从 1 起，0 视为 1，负数 40001） |

**响应 data**：`{total, items}`（按 `equipment_type` 升序）。

```json
GET /api/mechanism-profiles?equipment_type=SEER&limit=10&page=1

HTTP 200
{"code":0,"message":"ok","data":{"total":1,"items":[
  {"id":1,"equipment_type":"SEER-FORK","brand":"SEER",
   "mechanism":"{\"actions\":[{\"name\":\"REACH_OUT\",\"do_id\":1}],\"io\":[{\"channel\":\"DI\",\"id\":3}]}",
   "updated_at":"2026-10-06T10:20:31.123+08:00"}]}}
```

---

### 2. 按设备类型取档案

`GET /api/mechanism-profiles/:equipment_type`

**路径参数**：`equipment_type`（必填）。

**响应 data**：`{id, equipment_type, brand, mechanism, updated_at}`。该设备类型还没配时返回空配置行（`equipment_type` 原样回显，其余字段为空），由调用方按"该机型没配机构"处理。

---

### 3. 保存档案（覆盖式）

`PUT /api/mechanism-profiles/:equipment_type`

**作用**：按设备类型覆盖保存（不存在则新建）；`mechanism` 传空串表示清空该设备类型的机构配置（写 NULL）。校验规则见上文「保存时的校验」。

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| brand | string | 否 | 品牌（最长 64） |
| mechanism | string | 否 | 机构配置 JSON 原文（最长 1MB；空=清空） |

**响应 data**：保存后的完整行（结构与第 2 节一致）。

**错误场景**：`equipment_type` 为空或超长 → 40001；`mechanism` 超过 1MB → 40001；`mechanism` 结构非法（不是合法 JSON 对象、动作名重复、IO 通道非法、标识不是整数、动作序列引用了不存在的动作名）→ 40001。

---

### 4. 删除档案

`DELETE /api/mechanism-profiles/:id`

**作用**：按主键删除一份车体机构档案。

**响应**：`{code: 0, message: "ok"}`；不存在 → 200 + 40401。

## 六、端到端串一遍（配场景 → 建组 → 派车执行）

```
① 配场景与模板

POST /api/scenes                  # 建元信息空壳
PUT  /api/scenes/{id}/template    # 提交模板 JSON（校验通过才写文件、回填 template_url、重建通知索引）
POST /api/third-parties           # 模板的通知行按编号引用的第三方地址

② 上游按场景编码建任务组

POST /api/task-groups/PL-FEED
{"task_group_code":"TG-1","vehicle_code":"VEH001","map_code":"MAP-1",
 "segments":[{"seq":1,"start_location":"S0","end_location":"A-001","start_location_type":"08","end_location_type":"08"},
             {"seq":2,"start_location":"A-001","end_location":"B-02","start_location_type":"08","end_location_type":"08"}]}

→ 编排按模板折算子任务，组与子任务在同一事务里写入，子任务状态【待下发】
  （模板 start_at 之前的节点写【已跳过】；组级起终点没给时取第一段 / 最后一段的起终点）

③ rcs-dispatch（独立服务，见 md/dispatch.md）取【待下发】

→ 组内串行：只取本组最靠前的未完成子任务
→ 选车 → 规划路线 → 发 order → 执行机构动作与 DO/DI → 按任务的 notify 配置通知第三方
→ 回写子任务状态（车号、当前位置、时间戳）与任务组状态

④ 配了「不继续任务」时组挂起

本段动作的 is_continue_task=false 且组内还有后续子任务 → 任务组置【已暂停】，
后续子任务留在【待下发】不再派发；调 POST /api/task-groups/{id}/continue 放行，
组置【待执行】，调度继续派发。

⑤ 收尾

组内子任务全部终态（【已跳过】算处理完）→ 任务组收尾为【已完成】；
需要人工中止时调 POST /api/task-groups/{id}/cancel，组内未完成子任务全部置【已取消】。
```
