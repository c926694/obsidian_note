# 导航地图接口文档（rcs-map 导航文件）

> 服务：网关 `rcs-gateway`（`/api/nav-maps*`）+ rpc `rcs-map`
> 迁移：`common/db/migrations/035_rcs_nav_map.sql`
> 表：`rcs_nav_map`（实例）+ `rcs_nav_map_version`（版本）

## 一、业务定位

导航地图是前端上传的机器人导航文件（格式不限：zip / smap / bin 等都可以），后端只负责**接收文件、存盘、留版本、供下载**，不解析文件内容，因此没有编辑接口。

- 导航地图有自己的实例表与版本表，与拓扑地图（`rcs_map_config`）通过 `map_code` 关联，一张拓扑地图对应一张导航地图（`map_code` 唯一）。
- 关联是硬约束：创建导航地图时校验 `map_code` 在拓扑地图里存在（不存在回 40401）；拓扑地图改编号时导航地图的 `map_code` 同事务跟随；**删除拓扑地图会连同它关联的导航地图与全部版本文件一起删除**。
- 每次上传或替换产生一个版本，版本号由后端从 1 开始自增；文件按版本命名归档，**每个导航地图只保留最近 10 个版本**（超出部分在替换时连同库行一起删）。
- 导航地图没有编辑锁：多人同时上传由数据库事务与版本号自增保证不丢数据，不需要前端配合拿锁。

## 二、通用约定

- 路径前缀 `/api`，响应统一信封 `{code, message, data}`；业务失败一律 HTTP 200，前端按 `code` 判断。
- 业务码：`0` 成功、`40001` 参数错误、`40401` 不存在、`40901` 冲突、`50001` 服务器内部错误、`50301` 依赖服务不可用。
- 文件下载：`file_path` 是对外相对路径（形如 `/static/navmaps/NAV-A/NAV-A_v1.zip`），前端拼自己的后端地址访问，网关静态目录与 rpc 指向同一份数据。

### 表结构

`rcs_nav_map`（一张导航地图一行）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | integer 自增 | 否 | 主键 |
| nav_map_code | varchar(50) | 否 | 导航地图编号（业务键，唯一） |
| map_code | varchar(50) | 否 | 关联的拓扑地图编号（唯一，创建时校验存在） |
| brand | varchar(64) | 是 | 适用品牌（空 = 不限） |
| agv_type | varchar(64) | 是 | 适用车型（空 = 不限） |
| file_path | varchar(500) | 否 | 最新版本文件对外相对路径 |
| version | integer | 否 | 最新版本号（首次上传即 1） |
| updated_at | timestamptz | 否 | 更新时间（上传或替换时刷新） |

`rcs_nav_map_version`（每次上传/替换一行）

| 列 | 类型 | 可空 | 说明 |
|---|---|---|---|
| id | integer 自增 | 否 | 主键 |
| nav_map_code | varchar(50) | 否 | 所属导航地图编号（软引用） |
| version | integer | 否 | 版本号（同一导航地图内唯一） |
| file_path | varchar(500) | 否 | 该版本文件对外相对路径 |
| created_at | timestamptz | 否 | 上传时间 |

### 文件归档规则

| 项 | 规则 |
|---|---|
| 目录 | `<NavMapDir>/<导航地图编号>/`（开发环境是项目根 `data/navmaps`，容器里是 `/data/navmaps`） |
| 文件名 | `<导航地图编号>_v<版本号><原后缀>`，后缀沿用上传文件名，非法后缀（非字母数字、超长）丢弃 |
| 中转目录 | `<NavMapDir>/.tmp/`，网关把上传字节先流式写到这里，rpc 归档后该文件即消失 |
| 上传链路 | 网关收 multipart → 写中转文件 → 调 rpc 传中转文件名 → rpc 改名归档 → 入库 → 裁剪旧版本；**文件字节不经过 gRPC** |

## 三、接口总览

| 序号 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | POST | `/api/nav-maps` | 上传文件并新建导航地图（multipart） |
| 2 | GET | `/api/nav-maps` | 列表（分页 + 过滤） |
| 3 | GET | `/api/nav-maps/:id` | 详情 |
| 4 | PUT | `/api/nav-maps/:id/file` | 替换文件（版本 +1，multipart） |
| 5 | GET | `/api/nav-maps/:id/versions` | 版本列表（倒序，最多 10 条） |
| 6 | POST | `/api/nav-maps/:id/rollback` | 取指定版本的文件地址（不改状态） |
| 7 | DELETE | `/api/nav-maps/:id` | 删除导航地图（含全部版本文件） |

## 1. 上传并新建导航地图

`POST /api/nav-maps`，`Content-Type: multipart/form-data`

| 字段 | 位置 | 必填 | 说明 |
|---|---|---|---|
| nav_map_code | 表单文本 | 是 | 导航地图编号，最长 50，全局唯一 |
| map_code | 表单文本 | 是 | 关联的拓扑地图编号，最长 50，必须已在拓扑地图里存在，且未被别的导航地图占用 |
| brand | 表单文本 | 否 | 适用品牌，最长 64 |
| agv_type | 表单文本 | 否 | 适用车型，最长 64 |
| file | 文件 | 是 | 导航文件本体（字段名固定 `file`，一次只收一个文件） |

请求示例：

```bash
curl -X POST "http://<后端地址>:8110/api/nav-maps" \
  -F "nav_map_code=NAV-A" -F "map_code=MAP-A" \
  -F "brand=seer" -F "agv_type=G4" \
  -F "file=@导航文件.zip"
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "nav_map_code": "NAV-A",
    "map_code": "MAP-A",
    "brand": "seer",
    "agv_type": "G4",
    "file_path": "/static/navmaps/NAV-A/NAV-A_v1.zip",
    "version": 1,
    "updated_at": "2026-09-22T10:07:05.362092+08:00"
  }
}
```

说明：

- 新建的版本号固定为 1，前端不传版本号。
- `map_code` 必须是拓扑地图里已存在的编号，不存在 → `40401 关联的拓扑地图 <编号> 不存在`。
- `nav_map_code` 或 `map_code` 已被占用 → `40901`；缺编号或没带文件 → `40001`。
- 单文件上限 50MB（超过返回 `40001 上传文件超过 50MB 上限`）；上传路由的超时是 120 秒，其他接口仍是 10 秒。

## 2. 列表

`GET /api/nav-maps?nav_map_code=&map_code=&brand=&agv_type=&limit=&page=`

过滤字段留空 = 不过滤（精确匹配）；分页规则与其他域一致：`limit` 默认 100、上限 1000，`page` 从 1 起。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 2,
    "items": [
      {
        "id": 1,
        "nav_map_code": "NAV-A",
        "map_code": "MAP-A",
        "brand": "seer",
        "agv_type": "G4",
        "file_path": "/static/navmaps/NAV-A/NAV-A_v12.zip",
        "version": 12,
        "updated_at": "2026-09-22T10:10:04.823586+08:00"
      }
    ]
  }
}
```

`brand` / `agv_type` 为空时响应里不出现这两个字段。

## 3. 详情

`GET /api/nav-maps/:id`，`data` 同上单条结构；不存在 → `40401 导航地图 <id> 不存在`。

## 4. 替换文件

`PUT /api/nav-maps/:id/file`，`Content-Type: multipart/form-data`，只收一个文件字段 `file`。

```bash
curl -X PUT "http://<后端地址>:8110/api/nav-maps/1/file" -F "file=@新的导航文件.smap"
```

响应里的 `data` 与详情一致，`version` 变为 2，`file_path` 指向新文件；旧版本文件仍然保留（上限 10 个）。编号、关联地图、品牌、车型这些元信息不变，导航地图没有改元信息的接口。

## 5. 版本列表

`GET /api/nav-maps/:id/versions`，按版本号倒序（最新在前），最多 10 条。

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {"version": 2, "file_path": "/static/navmaps/NAV-A/NAV-A_v2.smap", "created_at": "2026-09-22T10:07:08.778709+08:00"},
    {"version": 1, "file_path": "/static/navmaps/NAV-A/NAV-A_v1.zip", "created_at": "2026-09-22T10:07:05.362092+08:00"}
  ]
}
```

导航地图不存在 → `40401 导航地图 <id> 不存在`。

## 6. 取指定版本（回滚）

`POST /api/nav-maps/:id/rollback`，body 传版本号。

```json
{"version": 1}
```

```json
{
  "code": 0,
  "message": "ok",
  "data": {"version": 1, "file_path": "/static/navmaps/NAV-A/NAV-A_v1.zip", "created_at": "2026-09-22T10:07:05.362092+08:00"}
}
```

这个接口**只返回该版本的文件地址，不改任何状态**：不动最新版本号、不动磁盘文件；前端拿到地址后自行下载使用（例如回灌给机器人）。下次上传仍按最新版本号 +1 生成新版本。

版本不存在 → `40401 导航地图 <id> 的 v<版本> 版本不存在`；版本行在但文件已被外部删除 → `40401 导航地图 <id> 的 v<版本> 文件已缺失`。

## 7. 删除导航地图

`DELETE /api/nav-maps/:id`，成功 `{"code":0,"message":"ok","data":null}`。

删除动作 = 删版本行 + 删主行（同一事务）+ 清掉 `<NavMapDir>/<编号>/` 下的全部版本文件与空目录。文件删除失败只记日志不阻塞（此时库已删除，残留文件不影响功能）。删除后同一个 `nav_map_code` 可以重新上传。

这条删除还有一个来源：**删除它关联的那张拓扑地图时，本导航地图与其全部版本文件会被一并删除**（`DELETE /api/maps/:id` 的级联动作，见 `map.md` 第 5 节）。前端删除拓扑地图时的二次确认文案要把这一点带上。

## 四、错误码汇总

| 场景 | code | message |
|---|---|---|
| 请求不是 multipart | 40001 | 参数错误: 请求必须是 multipart/form-data（含文本字段与 file 文件字段） |
| 没带文件 | 40001 | 参数错误: 缺少上传文件（文件字段名固定为 file） |
| 缺 nav_map_code / map_code | 40001 | 参数错误: 必填字段缺失: nav_map_code / map_code |
| 文件为空 | 40001 | 参数错误: 上传的文件内容为空 |
| 文件超过 50MB | 40001 | 参数错误: 上传文件超过 50MB 上限 |
| 关联的拓扑地图编号不存在 | 40401 | 关联的拓扑地图 <编号> 不存在 |
| 详情 / 替换 / 删除 / 版本列表的目标不存在 | 40401 | 导航地图 <id> 不存在 |
| 回滚的版本不存在 | 40401 | 导航地图 <id> 的 v<版本> 版本不存在 |
| 编号或关联地图编号被占用 | 40901 | 导航地图编号 <编号> 或关联的拓扑地图编号 <编号> 已被占用 |
| rpc 不可达 | 50301 | 依赖服务不可用，请稍后重试 |

## 五、前端配合要点

1. 上传用 `FormData`，文件字段名固定 `file`；浏览器不要手写 `Content-Type`，让它自己带 boundary。
2. 版本号、文件路径都由后端生成，前端不要传；返回的 `file_path` 拼上后端地址即可下载。
3. 版本下拉直接用第 5 个接口，最多 10 条；想用某个历史版本就用第 6 个接口取地址。
4. 删除是不可撤销操作（版本文件一并删除），前端需要二次确认。
5. `map_code` 从现有拓扑地图列表里选，别让用户手填：填了库里没有的编号会被 40401 挡下。
