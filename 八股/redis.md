# 缓存穿透

当请求查询不存在的key时，缓存和db都不存在,如果有人恶意执行这样的查询，db会扛不住

## 缓存空值

即使redis和db都不存在数据，我们也去缓存空值到redis,让恶意请求不打到数据库

## 布隆过滤器

原理:维护一个bit位数组;

1. 预热:通过多种哈希函数计算预热key位于的数组位置，标记为1

2. 判断:对key进行多种哈希函数计算，如果结果位置都为1则通过布隆过滤器，有1个0则不通过

- 布隆过滤器可能会导致误判，我们可以在设置布隆过滤器的时候指定误判率

- 只用位数组计数，内存占用少,如果要降低误判率需要提高数组大小

- 可以通过Guava、redisson框架设置布隆过滤器

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=YjE0ZTYyZTYyNTUzMTYyMWQwMmYyMDViMWEyZjVmNjJfYm9BQzVrN2dSYU9QbGM3UU1ISjVSSHg0aEg3eVFZMlhfVG9rZW46UlNVaGJNQlVVb1pCSTd4bTBrUWNaVlI5blljXzE3ODMzMjI4NTQ6MTc4MzMyNjQ1NF9WNA&add_watermark=true&scene_type=CCM)

# 缓存击穿

热点key问题，一个高并发的key过期,请求直接打到db

## 互斥锁

当缓存过期了,一个线程获取到互斥锁，开始查询db，并写到缓存

其余没有获取到互斥锁的线程while(true)循环查询缓存

## 逻辑过期

给缓存设置一个逻辑过期变量值,实际并不设置ttl

查询redis判断是否过期

过期则让一个线程去获取互斥锁开启异步线程查db更新缓存

无论有没有获取锁，都直接返回旧数据

**对比**

1. 互斥锁强一致性，但性能低

2. 逻辑过期高可以,不能保证数据绝对一致，只能是最终一致性

## singleflight

Go 标准库扩展包 `golang.org/x/sync/singleflight`

原理：
- 同一时刻多个 goroutine 请求同一个 key
- 只有第一个真正执行，其余等待结果
- 所有调用者共享同一个结果，避免重复查询 DB

对比互斥锁：

| | 互斥锁 | singleflight |
|---|---|---|
| 执行次数 | 排队，N个线程各执行1次 | 仅执行1次 |
| 其余线程 | while(true)轮询缓存 | 直接等待结果 |
| 适用场景 | 单机 | 单机（Go 项目） |

# 缓存雪崩

高并发场景，大量缓存key过期或者redis宕机导致大量请求打入db

1. 随机ttl
2. 多级缓存
3. Redis集群
4. 降级限流

# 双写一致性

对于同一个对象,要保证查询db和查询redis的数据一致

对于同一个对象,要保证查询db和查询redis的数据一致

选哪个方案看业务场景：

| 场景 | 方案 | 一致性 |
|---|---|---|
| 普通项目 | 更新DB-删缓存 | 最终 |
| 高并发、要更稳 | 延迟双删 | 最终 |
| 已有MQ | 异步删 | 最终 |
| 强一致 | 读写锁 | 强一致 |

## 更新DB-删缓存（最常用）

```python
db.update(value)    # 更新DB
redis.delete(key)   # 删缓存
```

最简方案，小项目够用。但高并发下可能刚删完缓存就被另一个线程写回旧数据。

## 延迟双删

```python
db.update(value)       # 1. 更新DB
redis.delete(key)      # 2. 第一次删缓存
time.sleep(0.5)        # 3. etcd读线程写回缓存
redis.delete(key)      # 4. 第二次删兜底
```

第一次删掉旧数据，sleep 等读线程可能写回旧数据，第二次再删干净。

## 异步删

```
更新DB → 发MQ消息 → 直接返回
                ↓
         消费者 → 删缓存
```

适合已经用了 MQ 的项目，不需要业务代码里 sleep。
注意：要保证 MQ 消息可靠投递（本地消息表或事务消息）。

## 读写锁（强一致）

基于 Redisson 读写锁，写独占、读共享，保证强一致。性能低，适合秒杀/库存场景。

## Canal（解耦最彻底）

监听 MySQL binlog 自动删缓存，业务代码完全不用管删缓存的事。引入成本高，大厂用得多。

# 持久化

## Rdb

**Save**

开启主进程进行持久化，会阻塞其它操作

**Bgsave**

1. 主进程fork子进程,将页表也复制给子进程

2. 子进程读取内存数据生成rdb二进制文件

- 子进程采用copy-on-write方式读取内存,

rdb读取过程中，主进程的新的写操作会产生新的内存副本,

而子进程依旧读旧的内存

## Aof

内部记录redis执行的所有写命令

**对比**

默认只开启rdb

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=Zjk1NzQ2ZGNhYTFjZmE1YWJlOTM4NGNiYjg4OGQ5ZjVfeFhWdTZaUDZoZmcyeWRIRGQ2RDBHRVU5Z1EyYXVHd0NfVG9rZW46TVd4WWJLMUtOb1lqU1B4UW8zV2NqQlk4bnZkXzE3ODMzMjI4NTQ6MTc4MzMyNjQ1NF9WNA&add_watermark=true&scene_type=CCM)

# 数据过期策略

Redis 为了平衡 **CPU 开销******和****内存利用率****， 采用 **惰性删除 + 定期删除** 的过期策略。

- **惰性删除**：访问 key 时检查是否过期

- **定期删除**：Redis 周期性随机检查并删除过期 key

如果内存达到上限，还会触发 **内存淘汰策略**。

# 数据淘汰策略

Redis 在内存达到 `maxmemory` 限制时，会触发 **内存淘汰策略**。

常见策略包括：

- **LRU**：最近最少使用

- **LFU**：访问频率最低

- **random**：随机淘汰

- **TTL**：淘汰即将过期的数据

- **noeviction**：不淘汰，直接报错

allkeys-lru（最常见）

原因：

- 可以淘汰所有 key

- 符合缓存使用场景

# 主从集群

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=ODc4Y2FkOGQwMDlkOGIzMGVmOTE1MDRiYmM5YjViMWZfbkx4dUk3TURtdFFFWmtwOGpCVkpnTXJRak5tdFcwZ2xfVG9rZW46S3IwbmJVTjZob2djWUh4R1ltM2NoMU5WblhjXzE3ODMzMjI4NTQ6MTc4MzMyNjQ1NF9WNA&add_watermark=true&scene_type=CCM)

# 哨兵模式

当redis主节点挂了，会选出一个从节点作为新的主节点，原来的主节点恢复后会变成从节点

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=YTU0ZDllMWYwNGNhOTdiNThmNjEyYmNlNzAzNDYzOTFfT3FjTWliQmNzSzYwQ2VRaGk4UkdwM0EwcjVGcXZ6WkxfVG9rZW46SW9GcGJPZVk0b0F4aG94SENld2NtTlZlbkNiXzE3ODMzMjI4NTQ6MTc4MzMyNjQ1NF9WNA&add_watermark=true&scene_type=CCM)

## 监控机制

多个sentinel进行ping来测试节点是否下线

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=OWM1MTlmZmYyNjA0MzVjNGQ4YjUzMTA0MWNiMDY3ZGRfNjlVQWlYdlhqRjg4N3psQ1pOeVlwTWZkYlkybHE0eTZfVG9rZW46VnBSRmJ1VkYxb1NFWUh4RlFhSWN0MkFHbnU4XzE3ODMzMjI4NTQ6MTc4MzMyNjQ1NF9WNA&add_watermark=true&scene_type=CCM)

## 集群脑裂

**Redis 节点之间的数据同步以及** **Sentinel** **对节点状态的检测都依赖 网络通信。如果发生网络分区，例如 Sentinel 无法通过网络访问原** **Master****，就可能误认为 Master 已经宕机。**

脑裂是指由于 **网络分区（Network Partition）**，导致 Redis 集群中 **同时出现多个** **Master** **对外提供服务** 的情况。

此时 Sentinel 会触发 **故障转移（Failover）**，从 Slave 中选举出一个新的 Master。但实际上原来的 Master 可能仍然在正常运行，并继续对外提供写服务。

于是就会出现：

- **旧** **Master** **继续接受写请求**

- **新** **Master** **也接受写请求**

这样就会导致 **数据不一致甚至数据丢失**，这就是 Redis 的脑裂问题。

为了减少脑裂带来的数据丢失，Redis 提供了两个配置：

- **min-replicas-to-write**：要求至少有指定数量的从节点同步成功，Master 才允许写入

- **min-replicas-max-lag**：限制从节点的最大同步延迟时间

通过限制 Master 的写入条件，可以在发生网络分区时降低数据丢失的风险。

# 分片集群

解决:

1. 海量数据存储

2. 高并发写

- 如果想要相同业务的key落在同一范围的槽中,就可以加业务前缀作为有效部分参与哈希运算

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=N2U5YzRjNGViY2FjN2Q2MDg0NjkzMWQ5YTkxN2Y0MGZfUlB3SGlZNnIwS2R2MzhFaFVHcDA3TVpvdTZqTW1yaktfVG9rZW46SmpmU2JDak9nbzhBUGJ4bkFxUWNGV0lMbmFmXzE3ODMzMjI4NTQ6MTc4MzMyNjQ1NF9WNA&add_watermark=true&scene_type=CCM)