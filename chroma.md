# Chroma 快速入门指南（Python）

## 什么是 Chroma？

**Chroma** 是一个开源、轻量级的向量数据库，专为 AI 应用设计，特别适合与 LLM 配合做 RAG（检索增强生成）。它支持多种嵌入模型，可以本地运行，也可以部署为服务。

## 安装

```bash
pip install chromadb
```

如果需要搭配 OpenAI 或其它嵌入模型：

```bash
pip install chromadb openai
```

## 核心概念

| 概念 | 说明 |
|------|------|
| **Collection** | 类似于关系数据库中的"表"，存放一组文档及其向量 |
| **Document** | 原始文本内容 |
| **Embedding** | 文档的向量表示（浮点数数组） |
| **Metadata** | 附加到文档上的键值对，用于过滤 |
| **ID** | 每个文档的唯一标识符 |

## 快速案例：从零到查询

下面是一个完整的端到端案例，演示 Chroma 的核心用法。

### 1. 创建客户端并初始化集合

```python
import chromadb

# 创建客户端（默认为内存模式，数据仅在进程生命周期内存在）
client = chromadb.Client()

# 如果需要持久化到磁盘：
# client = chromadb.PersistentClient(path="./chroma_data")

# 创建集合（如果已存在会报错，可以使用 get_or_create_collection）
collection = client.create_collection(
    name="quickstart_demo",
    # metadata={"hnsw:space": "cosine"}  # 可选：指定距离计算方式
)
```

### 2. 添加文档

```python
# 添加文档 —— Chroma 会自动使用默认的 all-MiniLM-L6-v2 模型计算嵌入
collection.add(
    documents=[
        "Chroma 是一个开源的向量数据库，专注于 AI 应用场景。",
        "向量数据库用于存储和检索高维向量，常用于语义搜索。",
        "RAG（检索增强生成）是 LLM 应用中的常见模式。",
        "Chroma 支持多种嵌入模型，包括 Sentence Transformers 和 OpenAI。",
        "元数据过滤可以帮助你精细化搜索结果。",
    ],
    metadatas=[
        {"source": "docs", "category": "intro"},
        {"source": "docs", "category": "concept"},
        {"source": "tutorial", "category": "rag"},
        {"source": "docs", "category": "embedding"},
        {"source": "tutorial", "category": "filter"},
    ],
    ids=["doc1", "doc2", "doc3", "doc4", "doc5"],
)

print(f"集合中的文档数量：{collection.count()}")
```

### 3. 查询（语义搜索）

```python
# 语义搜索 —— 按相关度返回最相似的文档
results = collection.query(
    query_texts=["什么是 RAG 技术？"],
    n_results=3,  # 返回最相关的 3 个结果
)

print("查询结果：")
for i, (doc, dist) in enumerate(zip(results["documents"][0], results["distances"][0])):
    print(f"  {i+1}. (距离: {dist:.4f}) {doc}")
```

输出示例：

```
查询结果：
  1. (距离: 0.7927) RAG（检索增强生成）是 LLM 应用中的常见模式。
  2. (距离: 0.6807) 向量数据库用于存储和检索高维向量，常用于语义搜索。
  3. (距离: 0.6413) Chroma 是一个开源的向量数据库，专注于 AI 应用场景。
```

### 4. 带元数据过滤的查询

```python
# 只搜索 source 为 "tutorial" 的文档
results = collection.query(
    query_texts=["向量数据库有哪些用途？"],
    n_results=5,
    where={"source": "tutorial"},  # 元数据过滤条件
)

print("过滤后的结果（仅 tutorial）：")
for doc in results["documents"][0]:
    print(f"  - {doc}")
```

### 5. 更新与删除文档

```python
# 更新文档内容
collection.update(
    ids=["doc1"],
    documents=["Chroma 是一个轻量级的开源向量数据库，专为嵌入和检索设计。"],
    metadatas=[{"source": "docs", "category": "intro", "updated": True}],
)

# 删除文档
collection.delete(ids=["doc5"])
print(f"删除后文档数量：{collection.count()}")
```

### 6. 使用自定义嵌入模型

```python
from chromadb.utils import embedding_functions

# 使用 Sentence Transformers 模型
sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)

collection_custom = client.create_collection(
    name="custom_embedding_demo",
    embedding_function=sentence_transformer_ef,
)

collection_custom.add(
    documents=["这是使用 Sentence Transformers 模型嵌入的文档。"],
    ids=["custom_doc1"],
)
```

> 你也可以使用 OpenAI 嵌入（需 `pip install openai`）：
> ```python
> openai_ef = embedding_functions.OpenAIEmbeddingFunction(
>     api_key="sk-xxx", model_name="text-embedding-ada-002"
> )
> ```

### 7. 持久化客户端（数据保存到磁盘）

持久化是 Chroma 最常用的模式 —— 数据写入磁盘，下次重启程序时仍然可用。

#### 7.1 基本用法

```python
import chromadb

# 关键：使用 PersistentClient 替代 Client()
client = chromadb.PersistentClient(path="./chroma_data")

# 第一次：创建集合并写入数据
collection = client.get_or_create_collection(name="persistent_demo")

collection.add(
    documents=["持久化到磁盘的数据，下次启动时仍然可用。"],
    ids=["persist_doc1"],
)

print(f"文档数量：{collection.count()}")
```

#### 7.2 下次启动时读取已有数据

```python
import chromadb

# 同一个 path，数据自动加载
client = chromadb.PersistentClient(path="./chroma_data")

# 获取已有的集合（不要用 create_collection，会报错）
collection = client.get_collection(name="persistent_demo")

# 数据还在！
print(f"文档数量：{collection.count()}")  # 输出 1

# 可以继续查询和添加
results = collection.query(
    query_texts=["持久化存储"],
    n_results=5,
)
print(results["documents"])
```

#### 7.3 完整的新建 -> 写入 -> 重启 -> 读取流程

```python
"""
第一次运行：写入数据
"""
import chromadb

client = chromadb.PersistentClient(path="./chroma_data")
collection = client.get_or_create_collection(name="notes")

collection.add(
    documents=["今天学习了 Chroma 的持久化配置。", "向量数据库可以把数据存到磁盘上。"],
    ids=["note1", "note2"],
)
```

```python
"""
第二次运行：读取之前的数据，继续添加
"""
import chromadb

client = chromadb.PersistentClient(path="./chroma_data")  # 同一个目录
collection = client.get_collection(name="notes")           # 获取已有集合

print(f"已有文档数：{collection.count()}")                 # 输出 2

# 继续添加新数据
collection.add(
    documents=["持久化让数据不会因为程序重启而丢失。"],
    ids=["note3"],
)

print(f"现在文档数：{collection.count()}")                 # 输出 3
```

## 服务端模式（Docker 部署，类似 MySQL）

这是你想要的模式 —— Chroma 跑在 Docker 容器里作为独立服务，代码通过 HTTP 连接它。

### 1. 拉取镜像并启动容器

```bash
# 拉取镜像
docker pull chromadb/chroma

# 启动容器（数据存在容器内，重启会丢）
docker run -p 8000:8000 chromadb/chroma
```

### 2. 挂载数据卷（持久化，推荐）

```bash
# 数据保存在宿主机的 ./chroma-data 目录
docker run -d \
  --name chroma \
  -p 8000:8000 \
  -v ./chroma-data:/data \
  chromadb/chroma
```

参数说明：

| 参数 | 作用 |
|------|------|
| `-d` | 后台运行 |
| `--name chroma` | 容器命名为 `chroma` |
| `-p 8000:8000` | 映射端口，宿主机 8000 → 容器 8000 |
| `-v ./chroma-data:/data` | 把宿主机目录挂载到容器内的 `/data`（持久化关键） |

### 3. 验证服务是否启动

```bash
curl http://localhost:8000/api/v1/heartbeat
```

返回 `{"heartbeat":"..."}` 就说明成功了。

### 4. Python 代码连接

```python
import chromadb

# 像连 MySQL 一样连接远端的 Chroma 服务
client = chromadb.HttpClient(host="localhost", port=8000)

# 后面用法跟本地一模一样
collection = client.get_or_create_collection(name="docker_demo")
collection.add(
    documents=["通过 Docker 服务存储的数据，和 MySQL 一样的用法。"],
    ids=["doc1"],
)

results = collection.query(
    query_texts=["Docker"],
    n_results=5,
)
print(results["documents"])
```

### 5. Docker Compose（推荐）

创建 `docker-compose.yml`：

```yaml
version: "3.8"
services:
  chroma:
    image: chromadb/chroma
    container_name: chroma
    ports:
      - "8000:8000"
    volumes:
      - ./chroma-data:/data
    restart: unless-stopped
```

启动：

```bash
docker-compose up -d
```

### 6. 带认证（可选）

```python
# 服务端启动时传环境变量设置认证
# docker run -e CHROMA_SERVER_AUTH_CREDENTIALS=admin:password ...

# Python 客户端连接时带上认证
client = chromadb.HttpClient(
    host="localhost",
    port=8000,
    headers={"Authorization": "Basic YWRtaW46cGFzc3dvcmQ="},
)
```

### 7. 跟 MySQL 对比

| | **Chroma（Docker）** | **MySQL（Docker）** |
|---|---|---|
| 拉取镜像 | `docker pull chromadb/chroma` | `docker pull mysql` |
| 启动 | `docker run -p 8000:8000 chromadb/chroma` | `docker run -p 3306:3306 mysql` |
| 连接方式 | `HttpClient(host, port)` | `mysql.connector.connect(host, port)` |
| 默认端口 | 8000 | 3306 |
| 数据目录 | `/data` | `/var/lib/mysql` |
| 无需额外安装 | 只需 `pip install chromadb`（客户端） | 只需 `pip install mysql-connector-python` |

### 注意事项

- **版本匹配**：Docker 镜像版本和 `chromadb` pip 包的版本最好保持一致，避免协议不兼容。
- **查看最新版本**：去 [Docker Hub](https://hub.docker.com/r/chromadb/chroma) 查看可用 tags。
- **数据卷路径**：Windows 上 `./chroma-data` 是相对路径，也可以用绝对路径如 `D:/chroma-data`。

#### 7.5 注意事项

- **不要混用客户端类型**：`PersistentClient` 写入的数据不能用 `Client()` 读取，反之亦然。
- **`create_collection` vs `get_collection`**：第一次用 `create_collection`（或用 `get_or_create_collection` 更安全）；之后用 `get_collection`。
- **`get_or_create_collection` 最省心**：存在就获取，不存在就创建，适合反复运行的脚本。
- **目录结构**：在 `path` 目录下会自动生成 `chroma.sqlite3` 等文件，**不要手动修改它们**。

## 完整脚本

```python
"""
Chroma 快速入门 —— 完整示例
"""
import chromadb


def main():
    # 1. 创建客户端
    client = chromadb.Client()

    # 2. 创建集合
    collection = client.create_collection(name="demo")

    # 3. 添加文档
    collection.add(
        documents=[
            "Chroma 是一个开源的向量数据库。",
            "向量数据库常用于语义搜索。",
            "RAG 是 LLM 应用的常见模式。",
        ],
        ids=["id1", "id2", "id3"],
    )

    # 4. 查询
    results = collection.query(
        query_texts=["什么是 RAG？"],
        n_results=2,
    )

    print("=== 查询结果 ===")
    for doc in results["documents"][0]:
        print(f"  {doc}")


if __name__ == "__main__":
    main()
```

## 常用 API 速查

| 方法 | 作用 |
|------|------|
| `create_collection(name)` | 创建新集合 |
| `get_collection(name)` | 获取已有集合 |
| `get_or_create_collection(name)` | 获取或创建集合 |
| `delete_collection(name)` | 删除集合 |
| `collection.add(...)` | 添加文档 |
| `collection.update(...)` | 更新文档 |
| `collection.delete(ids=[...])` | 删除文档 |
| `collection.query(query_texts, n_results)` | 查询 |
| `collection.peek(limit)` | 查看前 N 条 |
| `collection.count()` | 获取文档数量 |
| `collection.modify(name, metadata)` | 修改集合配置 |

## 注意事项

- **默认嵌入模型**：Chroma 内置了 Sentence Transformers 的 `all-MiniLM-L6-v2` 模型，首次使用时会自动下载（约 80MB）。
- **内存 vs 持久化**：`Client()` 是内存模式，数据不持久；`PersistentClient(path)` 将数据写入磁盘。
- **距离计算**：默认使用 `l2`（欧氏距离），可在创建集合时通过 `metadata={"hnsw:space": "cosine"}` 改为余弦相似度。
- **批量添加**：`add()` 支持一次传入大量文档，性能优于逐条添加。
- **嵌入维度**：同一集合内的所有文档必须使用相同的嵌入模型（维度一致）。

## 参考资源

- [Chroma 官方文档](https://docs.trychroma.com/)
- [GitHub 仓库](https://github.com/chroma-core/chroma)
- [Sentence Transformers 模型列表](https://www.sbert.net/docs/pretrained_models.html)
