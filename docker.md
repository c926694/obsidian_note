## Docker 网络知识（后端开发视角）

### 一、三大内置网络

| 网络模式 | 一句话 | 后端要不要关心 |
|---------|--------|-------------|
| **bridge**（默认） | 容器间靠 IP 通信 | ✅ **最常用，必须懂** |
| **host** | 容器直接共用宿主机网络栈 | ⚠️ 特定场景 |
| **none** | 没网络 | ❌ 基本不用 |

---

### 二、bridge —— 打交道最多的

#### 默认 bridge

```bash
docker run redis
docker run web
```

- 所有容器挂在默认 `docker0` bridge 上
- **只能通过 IP 访问**，不能通过容器名
- IP 重启会变，不推荐

#### 自定义 bridge ✅（正确做法）

```bash
docker network create myapp-net
docker run --net myapp-net --name redis redis
docker run --net myapp-net --name web myapp
```

```python
r = Redis("redis", 6379)  # ✅ Docker 内置 DNS 自动解析服务名
```

**Compose 自动帮你做这件事**——每个 `docker-compose.yml` 自动创建自定义 bridge，所以能用服务名访问。

---

### 三、host —— 性能敏感场景

容器直接**借用宿主机 IP 和端口**，不走 NAT 转换。

```yaml
services:
  nginx:
    network_mode: "host"  # 容器监听 80 = 宿主监听 80，不用 ports 映射
```

**适合：** 高频交易、网关等对延迟极度敏感的场景  
**代价：** 隔离性差，不能同端口跑两个容器

---

### 四、端口访问全景图

```
                    外网用户
                        │
                        │ 公网IP:80
                        ▼
      ┌────────────────────────────────────┐
      │               宿主机                │
      │  ┌──── iptables NAT 规则 ──────┐   │
      │  │  ports: "8080:5000" 的含义：  │   │
      │  │  宿主机 8080 → 容器 5000     │   │
      │  └──────────────────────────────┘   │
      │                    │                │
      │                    ▼                │
      │        ┌──────────────────┐         │
      │        │  bridge 网络      │         │
      │        │  172.17.0.0/16   │         │
      │        │                  │         │
      │        │  nginx:80        │         │
      │        │   ↓              │         │
      │        │  web:8000        │         │
      │        │   ↓              │         │
      │        │  redis:6379      │         │
      │        │  db:5432         │         │
      │        └──────────────────┘         │
      └────────────────────────────────────┘
```

---

### 五、后端速查表

| 场景 | 怎么连 | 代码里怎么写 |
|------|--------|------------|
| **容器→同项目容器** | `服务名:容器内部端口` | `redis:6379` |
| **宿主机→容器** | `localhost:映射端口` | `localhost:6381` |
| **外部→容器** | `公网IP:映射端口` | 通过 Nginx/负载均衡 |

> `ports: "6381:6379"` → 左边（6381）是给外面人用的，右边（6379）是容器内部用的。同一个 Docker 网络里的容器互相访问，永远用右边。

---

### 六、实际项目拓扑

#### 单体后端

```yaml
services:
  web:
    build: .
    ports:
      - "80:8000"      # 只有 web 暴露

  redis:
    image: redis:7     # 没有 ports，内部用 redis:6379 访问
  db:
    image: postgres:15 # 没有 ports，内部用 db:5432 访问
```

#### 微服务

```yaml
services:
  api-gateway:
    build: ./gateway
    ports:
      - "80:80"
    networks:
      - frontend
      - backend

  user-service:
    build: ./user
    networks:
      - backend

  redis:
    image: redis:7
    networks:
      - backend       # 只有 backend 网络能访问

networks:
  frontend:
  backend:
```

---

### 七、常用调试命令

```bash
# 查看网络
docker network ls

# 查看谁在这个网络里
docker network inspect myapp_default

# 进容器测试连通性
docker exec -it web bash
ping redis
curl redis:6379
nslookup redis
nc -zv redis 6379
```
