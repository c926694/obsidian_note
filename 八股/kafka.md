# 基础认知

## 核心架构

| 组件 | 一句话核心作用 |
|------|---------------|
| **Producer** | 生产者，将消息**发布**到指定 Topic，控制分区策略、确认机制（acks） |
| **Broker** | 消息代理节点，Kafka 集群的**服务器实例**，负责消息存储、收发、副本管理 |
| **Consumer** | 消费者，从 Topic **拉取（pull）** 消息，通过 Consumer Group 实现负载均衡 |
| **Topic** | 逻辑上的消息**类别/频道**，消息按 Topic 组织 |
| **Partition** | Topic 的**物理分片**，并行度和有序性的最小单元 |
| **ZooKeeper / KRaft** | 元数据**协调者**，负责选主（Controller）、集群成员管理（新版 KRaft 逐步替代 ZK） |
| **Controller** | 集群**大脑**，负责 Partition Leader 选举、副本状态机管理（由某个 Broker 兼任） |
| **Consumer Group** | 消费组，实现**点对点**（组内单消费）与**发布订阅**（组间多消费）两种模型 |

**Producer** — 发送确认：`acks=0`（不确认）、`acks=1`（Leader 确认）、`acks=all`（ISR 全部确认）；分区策略：轮询、key 哈希、自定义；幂等与事务：`enable.idempotence=true` + `transactional.id` 实现精确一次语义（EOS）

**Broker** — 无状态设计（不维护消费者 offset，由 Consumer 自行提交到 `__consumer_offsets`）；高性能得益于顺序写磁盘 + Page Cache + 零拷贝（`sendfile`）+ 批量压缩；每个 Broker 可承载数千个 Partition

**Consumer & Consumer Group** — Pull 模型主动拉取，无背压问题；Rebalance 在组成员/分区变更时触发，`static group membership` 可缓解重平衡风暴；Offset 提交分自动（可能重复消费）与手动（精确控制）

**Partition & 副本机制** — Leader-Follower 模型：1 个 Leader（读写）+ N 个 Follower（同步备份）；ISR（In-Sync Replicas）是一致性核心；AR（Assigned Replicas）为全部分配副本；OSR（Out-of-Sync Replicas）为落后副本

**Controller** — Leader 选举（从 ISR 中选最合适的 Follower）；Partition 分配与迁移；Topic 创建/删除/修改

## Topic → Partition → Replica 关系

层层向下：一个 **Topic** 切分为多个 **Partition** 实现并行，每个 **Partition** 有多个 **Replica** 实现高可用。

| 层级 | 作用 |
|------|------|
| **Topic** | **逻辑隔离**，消息的分类容器，生产者写 Topic、消费者读 Topic，解耦双方 |
| **Partition** | **物理分片 + 并行单元**，消息水平切分，Partition 内有序；Partition 数 = 最大并发度 |
| **Replica** | **冗余容错**，Leader 负责读写，Follower 同步备份；Broker 宕机时从 ISR 中晋升新 Leader |

**Offset（偏移量）** — Partition 内每条消息的**逻辑序号**，不是文件物理位置。
- 消息追加时由 Leader Broker 按顺序递增分配（从 0 开始）
- Consumer 用 offset 标记消费进度：消费到 offset=X → 下一条拉 offset=X+1
- 可以**主动 seek 到任意 offset** 重新消费（回退、回溯）
- Offset 只在所属 Partition 内有效，不同 Partition 间独立计数

## 高吞吐核心机制


1. **顺序写磁盘** — 消息只追加到 Partition 日志末尾，不做原地修改。磁盘顺序写 ≈ 600MB/s，随机写 ≈ 100KB/s，**差距 6000 倍**。这是 Kafka 吞吐的基石。

2. **零拷贝（Zero-Copy）** — 解决"数据只是过个路，却被来回倒腾 4 次"的问题。Consumer 消费数据 = Broker 读磁盘 → 通过网络发回给 Consumer，数据从始至终不需要经过用户态应用。

**传统 IO**
```
① 磁盘→PageCache(用户态→内核态)   // read + DMA 读
② PageCache→应用(内核态→用户态)   // CPU 拷贝 + read 返回
③ 应用→Socket(用户态→内核态)     // write + CPU 拷贝
④ Socket→网卡(DMA)               // 异步 DMA 写
```

**零拷贝 sendfile**
```
① 磁盘→PageCache(用户态→内核态)   // sendfile + DMA 读
② PageCache→Socket(CPU描述符)     // 无切换
③ Socket→网卡(DMA)               // 异步 DMA 写
```
省去 2 次全量 CPU 拷贝 + 2 次上下文切换。

3. **批量处理** — 生产端：消息攒批发送（batch.size / linger.ms），减少网络往返。消费端：fetch.min.bytes 批量拉取。服务端：日志分段（Segment）批量清理。压缩也在批次级别做，压缩率更高。

4. **分区并行** — Partition 是 Kafka 并行的最小单元，N 个 Partition = N 路并行通道。

   **体现在四个层面**：

   | 层面 | 怎么并行 | 效果 |
   |------|---------|------|
   | **存储** | 每个 Partition 独立写日志，互不干扰 | **无锁竞争** |
   | **Broker** | Partition 分布在不同机器 | 读写**水平分散**，加机器 = 加吞吐 |
   | **Producer** | 同时发往不同 Partition | N × 单 Partition 顺序写速度 |
   | **Consumer** | 组内最多 N 个 Consumer 各吃一个 Partition | 消费能力**线性扩展** |

   **关键限制**：Partition 内有序、Partition 间无序。想保证全局有序就只能用 1 个 Partition（牺牲并行度）。

## 推拉模型

Kafka 采用"生产推送、消费拉取"的混合模型，核心原则是**消费速度由消费者自己控制**。

- **Producer → Broker：Push** — Producer 主动推送。Producer 有数据就推过来让 Broker 存，配合 acks 确认保障可靠
- **Broker → Consumer：Pull** — Consumer 主动拉取。**核心设计**：Consumer 自己控制速度，不怕消费不过来（无背压），可以批量拉取，可以回退 offset 重消费

**为什么不用 Broker Push？** 如果 Broker 主动推给 Consumer：
- Consumer 慢 → Broker 要反压/缓冲区堆积，复杂度爆炸
- Broker 要跟踪每个 Consumer 的消费能力，状态耦合
- 无法回退重消费（数据推出去就没了）

**Pull 模型的核心原理**：
1. Consumer 定期向 Broker 发送 FetchRequest，告知要拉取的 offset
2. Broker 查询对应 Partition 数据，一次性返回（受 fetch.min.bytes / fetch.max.bytes 控制）
3. Consumer 处理完一批后，提交 offset，继续下一轮拉取
4. 如果没新数据 → Broker 不立即返回，keep请求（`fetch.wait.max.ms`）→ 减少空轮询

这套设计让 Consumer 可以"吃饱了再吃下一口"，Broker 只管存数据，不用操心下游消化能力。

## 生产者消费者流程

**Producer 推流程**：应用调用 `producer.send()` 到 Broker 写入的完整链路。

```
应用线程                              Sender 线程（后台）        Broker Leader
   │                                      │                       │
   ├─ ProducerRecord(topic,key,value)      │                       │
   ├─ ① key+value 序列化成 byte[]          │                       │
   │    (StringSerializer / Avro / Protobuf)│                      │
   ├─ ② 分区器确定目标 Partition            │                       │
   │    key→hash(key)%分区数 / 无key→粘性轮询│                      │
   ├─ ③ 追加到 Accumulator                 │                       │
   │    对应 TopicPartition 的 batch 里      │                       │
   │    ┌─batch 满 (batch.size=16KB) ────→ │                       │
   │    └─linger.ms 超时 (默认0ms) ──────→ │                       │
   │                                      ├─ ④ 轮询就绪 batch     │
   │                                      ├─ ⑤ 按 Broker 分组打包  │
   │                                      ├─ ⑥ 构建 ProduceRequest│
   │                                      ├─ ⑦ NetworkClient 发送─→│
   │                                      │                       ├─ ⑧ 追加到 Partition 日志
   │                                      │                       ├─ ⑨ 分配 offset
   │                                      │                       ├─ acks=0: 直接回
   │                                      │                       ├─ acks=1: Leader 写完回
   │                                      │                       └─ acks=all: ISR 全写完回
   │                                      │←──────────────────── 响应(offset,时间戳)
   │←─ ⑩ Future.get() / Callback 完成 ───│                       │
```

**关键点**：
- **序列化**：key 决定分区路由，value 是业务数据，各用各的序列化器
- **分区器**：默认 murmur2 哈希，保证同 key 进同 Partition；无 key 用 **sticky partitioner**（粘性分区，攒满一批再换下一个分区，减少小批次）
- **Accumulator**：本质是个 `ConcurrentMap<TopicPartition, Deque<ProducerBatch>>`，消息追加到 batch，满了或超时就给 Sender 消费
- **Sender 线程**：只有一个，负责把就绪 batch 按 Broker 合并成请求发出去

**Consumer 拉流程**：从 FetchRequest 到处理完毕提交 offset 的完整链路。

```
Consumer                          Broker Leader
   │                                      │
   ├─ ① 加入 Consumer Group               │
   ├─ ② 分配 Partition ────────────────→  │ 组协调器分配
   │←─────────────────────────────────   你负责 Partition-0,1
   │                                      │
   ├─ ③ FetchRequest(offset=5) ────────→  │ 查日志文件
   │                                      ├─ 读对应 Segment（索引二分查找定位）
   │                                      ├─ 零拷贝 sendfile 发回
   │←─────────────────────────────────   消息 5,6,7,8
   ├─ ④ 反序列化 + 处理消息                │
   ├─ ⑤ commit offset=9 ──────────────→  │ 写入 __consumer_offsets
   ├─ ⑥ 继续下一轮拉取                    │
   └─ 回到 ③                              │
```

**关键点**：
- **FetchRequest**：携带 offset + `fetch.min.bytes`（攒够量才回）+ `fetch.max.wait.ms`（最多等多久）
- **Broker 处理**：先查索引文件二分定位 offset 的物理位置 → 读日志文件 → sendfile 零拷贝发出去
- **offset 提交**：
  - 自动提交（`enable.auto.commit=true`，默认每 5s 提交一次）→ 可能重复消费
  - 手动提交（`commitSync` / `commitAsync`）→ 精确控制，至少一次语义

## 重平衡（Rebalance）

Consumer Group 中 **Partition 所有权重新分配**的过程，本质是消费组的"成员变更选举"。

**何时触发**：
- Consumer **加入**组（新实例启动）
- Consumer **离开**组（关闭/崩溃）
- Consumer **超时**（`session.timeout.ms` 内没发心跳，被判定宕机）
- **Partition 数变更**（Topic 扩容）

**流程（Eager Rebalance，旧版默认）**：
Coordinator重新选举leader,分配partition
```
           Group Coordinator（某个 Broker）
                     │
Consumer-1 加入 ────→│ 感知到成员变更
                     ├─ ① 所有 Consumer 停止消费（Stop The World!）
                     ├─ ② 收回所有 Partition 分配
                     ├─ ③ 重新分配
  ←─────────────────│─ Consumer-1 → Partition-0,1
  ←─────────────────│─ Consumer-2 → Partition-2,3
  ←─────────────────│─ Consumer-3 → Partition-4,5
                     │ 恢复消费
```

**问题**：
- **Stop The World** — 重平衡期间所有 Consumer 暂停消费，导致消费延迟 spike
- **重复消费** — Partition 换人后，新 Consumer 从上次提交的 offset 开始，未及时提交的消息被重复处理

**优化方案**：

1. **Static Group Membership**（`group.instance.id` 固定成员 ID）
   - Consumer 重启后仍被视为"同一个成员"，不触发 Rebalance
   - 适用于长时间运行的有状态消费者

2. **Cooperative Rebalance**（新版增量协作式）
   - 不 Stop The World，分几轮逐步迁移 Partition
   - Consumer 先释放部分 Partition → 新 Consumer 接手 → 继续释放 → 直到平衡
   - 每轮只有少数 Partition 被暂停，大部分照常消费

## Kafka vs RabbitMQ vs RocketMQ

|          | **Kafka**         | **RabbitMQ**                           | **RocketMQ**      |
| -------- | ----------------- | -------------------------------------- | ----------------- |
| **模型**   | Topic + Partition | Exchange + Queue                       | Topic + Queue（分区） |
| **消费模型** | Consumer **拉取**   | **推+拉**都有（默认推送）                        | Consumer **拉取**   |
| **吞吐**   | **极高**（百万/秒）      | **低**（万/秒）                             | **高**（十万/秒）       |
| **延迟**   | 毫秒级               | **微秒级**                                | 毫秒级               |
| **顺序性**  | Partition 内有序     | 单队列有序                                  | 队列内有序             |
| **消息删除** | 按时间/大小**自动清理**    | **消费后删除**                              | 按时间清理，可回溯         |
| **事务**   | 支持（0.11+）         | 较弱                                     | **事务消息强**         |
| **路由**   | 无，靠分区             | **Exchange 灵活路由**（direct/topic/fanout） | 简单                |
| **适用**   | 日志、流处理、大数据        | 企业内部、复杂路由、低延迟                          | 电商交易、金融、事务        |

**一句话记**：
- **Kafka** — 为**吞吐**而生，日志/流处理王者，牺牲复杂路由
- **RabbitMQ** — 为**灵活路由 + 低延迟**而生，业务系统之间消息传递
- **RocketMQ** — **介于两者之间**，阿里为电商场景优化，事务消息最强

**选型**：大数据/日志选 Kafka，业务解耦/复杂路由选 RabbitMQ，电商交易/要事务选 RocketMQ。


# 消息

## 消息丢失场景

消息可能在三个阶段丢失，每个阶段都有对应的防御措施。

**生产阶段（Producer → Broker）**

| 原因 | 说明 | 解决方案 |
|------|------|----------|
| `acks=0` | 发出去就不管，网络丢包直接丢 | `acks=all` 等 ISR 全写完才回 |
| `acks=1` | Leader 写完就回，若 Leader 宕机且 Follower 没同步完，消息丢 | `acks=all` + `min.insync.replicas=2` |
| 重试耗尽 | 网络故障重试次数用完 | `retries=Integer.MAX_VALUE` + 幂等 |
| 发送超时 | `request.timeout.ms` 超时，Producer 放弃 | 回调里记录失败消息，落盘告警 |

**Broker 内部丢失**

| 原因 | 说明 | 解决方案 |
|------|------|----------|
| 未刷盘宕机 | 消息还在 Page Cache，没落盘就断电 | `min.insync.replicas=2` 靠副本容错 |
| `unclean.leader.election` | ISR 全挂，选了个落后副本当 Leader，缺消息 | `unclean.leader.election.enable=false` |
| 副本不足 | `min.insync.replicas=1`，唯一副本挂就丢 | `replication.factor=3` + `min.insync.replicas=2` |

**消费阶段（Broker → Consumer）**

| 原因 | 说明 | 解决方案 |
|------|------|----------|
| 自动提交 + 处理前崩溃 | offset 提交了但消息还没处理完 | 手动提交 `commitSync`，处理完再提交 |
| 业务吞异常 | catch 了 Exception 当成功，offset 照常提交 | 向上抛异常，不进 catch，让 Kafka 重试 |

**面试总结**：`acks=all` × `min.insync.replicas=2` × `unclean.leader.election=false` × 手动提交，四道关卡堵死。

## 消息重复消费

**根因只有一个**：消息处理了但 offset 没提交，下次从原 offset 重新拉，导致重复。

**常见场景**：

| 场景 | 过程 | 为什么重复 |
|------|------|-----------|
| **处理完没提交就崩** | 业务成功 → 提交 offset 前 crash | 重启后从旧 offset 拉，已处理的再吃一遍 |
| **Rebalance** | 处理到一半，Partition 被分走 | 新 Consumer 从上一次提交的 offset 拉 |
| **自动提交的间隙** | `auto.commit.interval.ms=5000`，第 3 秒 crash | 第 5 秒的提交没发生，重启漏了这 3 秒 |
| **处理超时被踢出组** | `max.poll.interval.ms` 超时，被踢 | 同 Rebalance，Partition 换人 |

**怎么解决重复消费**（而不是避免重复）：

重复消费只能减轻、不能完全避免（除非用事务），核心手段有两种：

- **幂等消费** — 业务层做去重。消息带上唯一 ID（业务主键 / UUID），消费前查是否处理过。这是最推荐的做法
  - 例：订单消息用 `order_id` 去重，已处理过的直接跳过
- **事务 + 精确一次** — Consumer 端开启事务，消息处理和 offset 提交在同一个事务里
  - `isolation.level=read_committed`，配合 `enable.auto.commit=false` 手动控制
  - 性能开销大，只有对重复极其敏感的场景才用

**面试一句话**：重复消费无法根除（一定会发生），靠**幂等消费**在业务层去重才是最务实的手段。

## 顺序性保证

**Kafka 只保证 Partition 内有序，不保证 Partition 间有序。** 这是吞吐和顺序的取舍。

**分区内有序如何实现**：

| 环节 | 保证机制 |
|------|----------|
| **Producer** | 相同 key 进同一 Partition（`hash(key) % 分区数`） |
| **Broker** | 消息追加到日志末尾，严格按 offset 递增 |
| **Consumer** | 每个 Partition 单线程消费，按 offset 顺序拉 |

**全局有序 vs 分区内有序**：

| | 分区内有序 | 全局有序 |
|--|-----------|---------|
| 怎么做 | 同 key 进同 Partition，单线程消费 | 整个 Topic 只有 **1 个 Partition** |
| 吞吐 | **高**，N 个 Partition 并行 | **极低**，单 Partition + 单 Consumer |
| 适用 | 绝大多数业务（按订单/用户路由） | 极少数全局严格有序（如 binlog） |

**常见坑**：
- `max.in.flight.requests.per.connection=1` — 0.11 之前防乱序用，幂等开启后不需要
- Consumer 多线程处理同一 Partition — 拉取有序但处理乱序，要保序只能单线程
- Rebalance 换人 — 新 Consumer 从提交的 offset 开始，中间可能有乱序

**为什么多分区无法全局有序**：

数据一旦分散到多个独立 Partition，就必然面临并行写入和并行消费：

```
Producer 按顺序发:  A(0) → B(0) → A(1) → B(1)
                    ↓        ↓        ↓        ↓
Partition-0:      A(0)     ——      A(1)      ——
Partition-1:       ——      B(0)     ——      B(1)
Consumer 拉到:    A(0) → B(0) → A(1) → B(1)  ← 顺序混了
```

Producer 发 A 和 B 到不同 Partition，网络延迟、batch 攒批、重试都会导致到达顺序和发送顺序不一致。Consumer 跨 Partition 并行拉取，天然无法保证全局有序。

**如何实现全局有序（特殊场景）**：

| 方案 | 怎么做 | 代价 |
|------|--------|------|
| **单 Partition** | Topic 只设 1 个 Partition | 吞吐受限，无法水平扩展 |
| **单 key 路由** | 所有消息用同一个 key，强行进同一 Partition | 等同于单 Partition |
| **外部排序** | 多 Partition 并行，Consumer 侧引入全局序号 + 排序合并 | 复杂度高，延迟增加，需要缓存 |

**面试一句话**：多分区无全局有序是**并行化的必然代价**——数据分散到多个独立通道，顺序就丢了。真要全局有序，单 Partition 是唯一稳健的方案。

## 消息乱序原因与避免

除了跨多 Partition 导致的天然无序，**即使在同一 Partition 内也可能出现乱序**。

**常见原因**：

| 原因                 | 说明                                                    | 发生在哪端    |
| ------------------ | ----------------------------------------------------- | -------- |
| **Producer 重试**    | `max.in.flight.requests=5`，请求 A 失败重试，B 先到 Broker，A 后到 | Producer |
| **多线程共享 Producer** | 多个线程同时 `send()`，发送先后和实际到达 Broker 的顺序不一致               | Producer |
| **Consumer 多线程处理** | 同一 Partition 的消息被多个线程并行处理，处理完成顺序不可控                   | Consumer |


**如何避免**：

| 场景                   | 解决方案                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| **Producer 重试乱序**    | 开启幂等（`enable.idempotence=true`），**序列号机制**保证重试不会乱序，不需要设 `max.in.flight.requests=1`             |
| **多线程发乱序**           | 保证同 key 进同 Partition；若同 Partition 内也要保序，Producer 端按 key 串行发送(设置Sync:false)或用同步 `send().get()` |
| **Consumer 多线程处理乱序** | 同一 Partition 只能单线程处理,即一个consumer+一个goroutine                                                  |

# 消息堆积

## 积压原因

**消费端**（最常见）
- 消费速度 < 生产速度（处理逻辑慢：调外部 API、DB 慢、重业务）
- Consumer 数 < Partition 数（有 Partition 没人消费）
- Consumer 挂掉/心跳超时被踢出组
- Rebalance 频繁（Stop The World 停止消费）

**生产端**
- 瞬时流量突增（大促/秒杀），消费跟不上
- 生产重试过多 + `acks=all`，写入变慢

**Broker 端**
- 磁盘 IO 瓶颈、网络带宽打满
- 热点 Partition（数据分布不均，单分区堆积）
- 机器资源不足、副本同步慢拖慢写入

## 排查步骤

```
Step1  确认积压现状
       kafka-consumer-groups --describe --group my-group
       → 看每个 Partition 的 LAG（积压量）
       → 哪个 Topic / Partition 积压最多？判断是否热点分区

Step2  对比生产速率 vs 消费速率
       看监控：每秒生产多少条 vs 每秒消费多少条
       → 生产 > 消费 = 能力不足
       → 生产 = 消费但 LAG 还在涨 = 有 Partition 没人消费

Step3  检查 Consumer 状态
       → Consumer 数量是否 < Partition 数？
       → 有没有心跳超时、被踢出组、频繁 Rebalance 的日志？
       → 有没有异常堆栈（调外部服务超时、DB 锁、OOM）？

Step4  检查 Broker 状态
       → 磁盘使用率？IO 等待？网络带宽？CPU？
       → ISR 是否正常？有没有副本落后？

Step5  定位根因
       把以上数据对齐，判断瓶颈在哪一端
```

**核心判别法**：
- LAG 均匀涨 + Consumer 正常 → **消费能力不足**
- 某个 Partition LAG 特别高 → **热点分区**
- Consumer 日志有 Rebalance/超时 → **消费中断**
- Broker 磁盘/网络打满 → **服务端瓶颈**

## 解决方案（按场景选）

| 场景                          | 最优方案                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| Consumer < Partition，消费能力不足 | 加 Consumer，加到 = Partition 数                                             |
| 处理逻辑慢（外部调用/DB）              | 优化逻辑：批量处理、异步化、加缓存，**别盲目加机器**                                            |
| 瞬时峰值积压                      | 削峰填谷（限流/延迟生产），或临时扩容                                                     |
| 严重积压，正常消费来不及                | **旁路方案**：新建临时 Topic（更多 Partition）→ 开更多 Consumer 快速拉下来 → 落库/落文件 → 再异步补处理 |
| 热点分区                        | 重新设计 key 分布，拆 key 粒度，均衡分区                                               |
| Broker 瓶颈                   | 加机器、扩磁盘、调网络，均衡 Partition 分布                                             |

**紧急兜底铁律**：先保证消息**不丢**（先拉下来存着），再慢慢处理，而不是硬扛。

## 加消费者能解决积压吗

**能解决，但有前提**：积压原因是 **Consumer 数 < Partition 数** 时，加 Consumer 立竿见影。

**但 Consumer 数不能超过 Partition 数**：一个 Partition 同一时刻只能被一个 Consumer 消费（同一 Group 内），这是 Kafka 为了**保序**做的强制约束——一个 Partition 被多个 Consumer 并发消费，分区内有序就没了。

```
Partition:  P0    P1    P2    P3
           ┌─┐   ┌─┐   ┌─┐   ┌─┐
Consumer:  C1    C2    C3    C4    ← 各吃一个，正好

再加 C5 → 没 Partition 可分 → C5 闲置摸鱼
```

**最大消费并行度 = Partition 数**，这是 Kafka 的硬上限。

**加消费者的正确姿势**：
- Consumer 数 < Partition 数 → 加 Consumer 有效，最多加到 Partition 数
- Consumer 数 = Partition 数 → 加 Consumer 没用，瓶颈在 Partition 数 → 得先扩 Partition，再加 Consumer

**面试一句话**：积压先看 LAG 定位瓶颈，Consumer 少就加消费者（上限是分区数），分区不够就扩分区，处理慢就优化逻辑，严重积压就旁路兜底。

