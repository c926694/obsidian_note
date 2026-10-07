# 调度服务（rcs-dispatch）接口与实现说明

> 定位：编排服务（rcs-orchestrator）把一次业务请求分成子任务并写成「待下发」之后，由本服务负责**派车执行**：选车、规划路线、发 order、跟车、执行机构动作与 DO/DI、按配置挂起任务组、把结果回写到任务表。
> 本服务**不监听 gRPC、不注册 Nacos**，与编排域通过**同一个 PostgreSQL** 的 `rcs_task` / `rcs_task_group` 衔接，没有互相调用的 RPC。
> 代码位置：`RCS/rpc/dispatch`（入口 `main.go`）。

---

## 1. 启动流程

| 步骤 | 位置 |
|---|---|
| 读配置（默认 `etc/dispatch.yaml`） | `rpc/dispatch/main.go` |
| 连库（含迁移；`RCS_PG_DSN` 可覆盖配置里的连接串，为空则终止） | `main.go`、`common/db` |
| 连接 rcs-vda 的 gRPC 客户端 | `main.go`（`vdaclient.NewVda`） |
| 建段锁存储（进程内内存实现；可切 Redis） | `main.go`、`internal/traffic` |
| 组装调度内核并启动 | `main.go`、`internal/sched`（`Scheduler.Start`） |
| 只读板面 HTTP（配了地址才起） | `main.go`、`gridlock_http.go` |
| 板面 MQTT 发布（配了才起） | `internal/sched/taskfeed.go` |

进程内并行的只有三件事：调度 ticker、只读板面 HTTP、板面 MQTT 发布。

---

## 2. 配置项

配置结构见 `rpc/dispatch/internal/config/config.go`，分段含义：

| 段 | 内容 |
|---|---|
| `Postgres` | 连接串（打包时按 `-ip` 改写为宿主库） |
| `VdaRpc` | rcs-vda 的 gRPC 目标；源码里是 `Endpoints` 直连，打包时删掉并改成 `Target: nacos://rcs-vda`（go-zero 里 `Endpoints` 优先，留着会绕过服务发现） |
| `Traffic` | 段锁存储：`Store` = `memory` / `redis`，以及地址、口令、库号、键前缀；Redis 键形如 `<prefix>:seg:<图>:<段>`；打包只改地址与口令，`Store` 保持源码取值 |
| `Schedule` | 调度参数（下表） |
| `Mqtt` | 板面发布（默认不配 = 关闭） |

`Schedule` 里的关键参数：

| 参数 | 含义 |
|---|---|
| `ScanIntervalSec` / `BatchSize` | 调度 tick 周期与单轮最多处理的子任务数 |
| `GraphReloadSec` | 唯一周期项：同时驱动地图重载与 `rcs_service_config`（现场可调参数）刷新 |
| `ReachThresholdMM` | 判定"到位"的阈值 |
| `MaxSnapDistanceMM` | 车辆位置到路网的吸附上限（超过就不派单） |
| `OffRouteToleranceMM` | 脱线容差 |
| `GridLockMM` / `GridLockTTLSec` | 格锁边长与过期时长 |
| `SafetyMarginMM` | 车体包络的安全余量 |
| `MinSegmentLenMM` | 最小段长（切段用） |
| `StuckTimeoutSec` / `ActionTimeoutSec` | 车辆停滞判超时、机构动作超时 |
| `PathPlanMode`、`ShelfPassEnabled`、`ShelfPassMarginMM`、`LocationPassPenaltyMM` | 路径模式与货架可穿规则 |
| `Detour*` | 借道绕行参数 |
| `GridLockHTTP` | 只读板面的监听地址（默认 `127.0.0.1:19110`） |

---

## 3. 数据表

**本服务自己维护的表**

| 表 | 用途 |
|---|---|
| `rcs_dispatch_run`（迁移 036） | 在途记录：一条子任务在车端跑起来后的订单号、地图、分段路线、当前段、状态、错误。用途有两个：服务重启后按订单号 + 车辆当前位置判断进度接着放行；排查时能直接看到"这条任务被切成几段、现在在第几段"。列：`task_code`（唯一）、`agv_code`、`map_code`、`order_id`、`order_update_id`、`route_codes`、`segments`（jsonb）、`current_segment`、`state`、`last_error`、两个时间戳；状态取值有进行中、停止中、让行、完成、失败等 |

**读写别人的表（同一个库）**

| 表 | 怎么用 |
|---|---|
| `rcs_task` | 读「待下发」的子任务及其点位、机构动作、信号、分支、锁车等列；回写状态、`agv_code`、`current_location`、`last_error`、时间戳，分支跳变时把跨过的节点置「已跳过」 |
| `rcs_task_group` | 读组状态与组内串行关系；回写组状态、`vehicle_locked`、`field_context` |
| `rcs_map_point` / `rcs_map_line` / `rcs_map_config` | 建图、吸附、路径规划、库位与休息位判定 |
| `rcs_rack` / `rcs_rack_type` | 货架尺寸（载具包络、可穿判定） |
| `rcs_agv_equipment_management` | 车辆档案：尺寸、机型、品牌、地图、中心点差量、开关等 |
| `rcs_carrier_type` / `rcs_map_avoidance_plan` / `rcs_mechanism_profile` | 载具尺寸、四向避障参数、机型机构档案 |
| `rcs_service_config` | 现场可调参数（按 `GraphReloadSec` 刷新） |
| `rcs_third_party` | 过程通知的目标地址 |
| `rcs_agv_code_dict` | 车号规范化 |

---

## 4. 调度循环

`Scheduler.Start`（`internal/sched/scheduler.go`）起 ticker，一轮 tick 的顺序固定：

1. 刷新现场可调参数与地图（按 `GraphReloadSec`）；
2. 读车辆位姿（`GetVehicleState`）；
3. 车队安全空间重叠检查；
4. 推进在途任务（`advanceOne`：跟车、判断到位、发下一段）；
5. 环路让行检查（会让行的任务退回「待下发」并释放段锁，不再占用车辆）；
6. 登记全车占用格（`refreshVehicleCells`）；
7. 取新任务（`dispatchNew` → `dispatchOne`）。

单条任务的派发：选车（`assign.go`）→ 建路线（`plan`）→ 发 order（`vdamsg`/`scheduler`）→ 写入途记录 → 把任务置「执行中」并回填车号与开始时间。

---

## 5. 路径规划（`internal/plan`）

只做几何与图算法，不碰业务：

| 文件 | 负责 |
|---|---|
| `graph.go` | 建图、加边（单向边）、A* 最短路、切段、段锁键（无向）、几何工具（毫米与弧度）、到路网距离、最近点吸附 |
| `fixedseg.go` | 全图固定段划分、按固定段切路线 |
| `curve.go` | 读 `rcs_map_line.geom` 展开曲线内插点 |
| `detour.go` | 借道 `detour_ok` 点位的绕行 |
| `traverse.go` | 通道优先与"可穿货架"判定 |
| `routegeom.go` | 车到自身路线的距离 |
| `footprint.go` | 车体包络与锁格几何（见 §8） |

---

## 6. 车辆分配（`internal/sched/assign.go`）

按**匈牙利算法**做最优匹配，代价是空驶距离：把待派任务与可用车辆配对，避免"谁先抢到谁跑"。

---

## 7. 机构动作、信号与车体报文

| 文件 | 负责 |
|---|---|
| `actions.go` | 把子任务上的 `actions` 解析成按序执行的步骤 |
| `mechanism.go` | 调 vda 的 `ExecuteMechanism`；每步取参优先级：`position`（档位）→ `height_mm`（高度）→ 动作名 |
| `signals.go` | 执行 DO/DI 时序（分组、并行或串行、是否等到位、超时与保持时长）；按车辆品牌取 `signals_by_brand`，没配就退回 `signals` |
| `vdamsg.go` | 渲染车体控制报文：`vehicle_control`（VDA 主题 + 报文）里的 `${类型.变量名}` 由系统数据替换后经 vda 原样发出；品牌变体同理 |
| `iface.go` | 节点上的接口调用（`iface`）：发 HTTP、按声明把响应里的值取成流程输出字段供后续节点与判断引用 |

---

## 8. 锁格与安全空间（几何口径）

单位统一为**毫米与弧度**。

| 量 | 算法 | 位置 |
|---|---|---|
| 包络半长 / 半宽 | `max(车体长, 载具长)/2 + 前后避障/2 + 安全余量`（半宽同式取宽） | `plan/footprint.go` |
| 中心点差量 | 运动中心到几何中心的差量（取自车辆档案 `center_offset_mm`） | `plan/footprint.go` |
| 四点长方形 | 车尾左 → 车尾右 → 车头右 → 车头左，沿车头再外伸一段车灯长度 | `plan/footprint.go`（`LockQuadAt`） |
| 占用格 | 按格心判定，格边长 = `GridLockMM`（默认 500 毫米） | `plan/footprint.go`（`LockCellsAt`） |
| 外接圆 | 原地旋转时用：圆心为包络中心，半径为 `hypot(半长, 半宽)` | `plan/footprint.go`（`LockCircleAt`） |
| 两车安全空间重叠 | 方向敏感矩形 + 分离轴判定 | `plan/footprint.go` |
| 组装包络 | 由车辆档案尺寸、载具类型尺寸、四向避障参数、中心点差量组装 | `sched/footprint.go`（`buildFootprint`） |
| 每轮登记与释放 | 对全部在线车登记，并**立即放掉本轮不再占用的格**（避免车身后拖长尾） | `sched/footprint.go`（`refreshVehicleCells` / `commitVehicleCells`） |
| 停靠位判定 | 休息位占用与可停判定（占用半径 2500 毫米） | `sched/footprint.go` |

格锁默认是**进程内内存实现**（`internal/traffic/grid.go`）；段锁可用内存或 Redis（`internal/traffic/redis.go`、`store.go`）。

---

## 9. 组挂起、分支跳变、等待与让行

| 能力 | 实现 |
|---|---|
| 组挂起（「已暂停」） | `sched/pausegroup.go`：本段配了「不继续任务」（`is_continue_task=false`）且组内还有后续子任务时，把任务组置「已暂停」；后续子任务留在「待下发」不再派发，等编排侧的「继续任务」接口放行。挂起期间不推进组状态 |
| 分支跳变（「已跳过」） | `store/branch.go`：按节点名与出线条件跳转，跨过的节点置「已跳过」（终态，不派发、不阻塞组收尾） |
| 等待图环路检测 | `sched/waitfor.go` |
| 借道绕行 | `sched/detour.go` |
| 锁车与换车 | `sched/switchvehicle.go`：按 `lock_vehicle` / `allow_switch_vehicle` 决定锁定与换车 |
| 回休息位 | `sched/parking.go`：空闲车的休息位派发与占用 |
| 过程通知 | `sched/thirdparty.go`：按任务的 `notify` 配置通知第三方 |
| 任务反馈 | 任务上的 `feedback` 配置（要不要上报、报给谁、开始与结束哪个时机报） |

---

## 10. 只读板面（HTTP 与 MQTT）

板面只有**只读**语义，且默认只听本机。

| 路径（调度侧） | 网关对外路径 | 内容 |
|---|---|---|
| `/tasks` | `GET /api/dispatch/tasks` | 在跑任务队列：`counts`（按状态的条数）与 `items`（任务号、状态、车号、起终点、错误、开始时间、控制方式），只取「待执行」与「执行中」 |
| `/grid-locks` | `GET /api/dispatch/grid-locks` | 锁格：图号、格边长、总格数与每车占用格、以及 `shapes`（四点长方形或原地旋转的外接圆，毫米） |
| `/parking` | `GET /api/dispatch/parking` | 休息位：总数、空闲、占用与每个位的坐标、占用车号、距离 |

网关侧由 `gateway-api/internal/boardproxy` 把上面三条代理到 `DispatchHttp`（配置项，默认 `127.0.0.1:19110`），只放行 GET/POST；现场没部署这两个接口时页面回退到 `/api/tasks` 并 60 秒后再试。

MQTT 板面（配了 `Mqtt` 段才开）：发布 `rcs/tasks` 与 `rcs/locks` 两个 retained 主题，一秒查一次、内容不变不发。

---

## 11. 与 vda、编排域的衔接

**调 vda 的方法**：`SendOrder`（发订单/改单）、`SendInstantActions`（取消）、`GetVehicleState`、`ListVehicles`、`ExecuteMechanism`、`ExecuteSignals`、`PublishVehicleMessage`（自定义主题报文）。

订单内容（`routeSpec`）：车号、订单号、订单更新序号、地图号、节点序列（每个节点是位置 `x/y/theta`、是否已放行、限速）。节点表给的是**剩余全路线**，已放行的段用放行前缀表达；改单保持同一个订单号、更新序号递增。

**与编排域的分工**：编排域建组写「待下发」；本服务只读这些行、按组内串行与组是否挂起过滤，派发时把任务置「执行中」并回填车号、位置、时间戳；收尾时推进组状态。两边没有 RPC 调用，衔接面就是这两张表。

---

## 12. 相关文件索引

| 内容 | 位置 |
|---|---|
| 入口与装配 | `RCS/rpc/dispatch/main.go` |
| 配置结构 | `RCS/rpc/dispatch/internal/config/config.go` |
| 调度循环与派发 | `RCS/rpc/dispatch/internal/sched/scheduler.go` |
| 车辆分配 | `RCS/rpc/dispatch/internal/sched/assign.go` |
| 机构动作、信号、车体报文 | `RCS/rpc/dispatch/internal/sched/{actions,mechanism,signals,vdamsg,iface}.go` |
| 组挂起、分支、等待、让行、休息位、通知 | `RCS/rpc/dispatch/internal/sched/{pausegroup,waitfor,detour,parking,thirdparty,switchvehicle}.go`、`internal/store/branch.go` |
| 路径规划 | `RCS/rpc/dispatch/internal/plan/` |
| 锁格几何 | `RCS/rpc/dispatch/internal/plan/footprint.go`、`internal/sched/footprint.go` |
| 锁存储 | `RCS/rpc/dispatch/internal/traffic/` |
| 只读板面 | `RCS/rpc/dispatch/gridlock_http.go`、`internal/sched/taskfeed.go` |
| 数据访问 | `RCS/rpc/dispatch/internal/store/store.go` |
| 在途记录表 | `RCS/common/db/migrations/036_rcs_dispatch_run.sql` |
| 网关代理 | `RCS/gateway-api/internal/boardproxy/boardproxy.go` |
