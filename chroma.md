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

```python
# 创建持久化客户端 —— 数据保存在指定目录
persist_client = chromadb.PersistentClient(path="./chroma_data")

persist_collection = persist_client.create_collection(
    name="persistent_demo"
)

persist_collection.add(
    documents=["持久化到磁盘的数据，下次启动时仍然可用。"],
    ids=["persist_doc1"],
)

print(f"持久化集合中的文档数量：{persist_collection.count()}")

# 下次使用时，只需用同样的 path 创建 PersistentClient
# 然后通过 get_collection 获取已有的集合即可
```

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
