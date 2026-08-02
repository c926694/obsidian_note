# 基础概念

|概念|可以怎样理解|
|---|---|
|`index`|一组同类文档的逻辑容器|
|`document`|index 中的一条 JSON 文档|
|`field`|document 中的一个字段|
|`mapping`|定义字段结构、字段类型以及索引行为|
如果和其他基础设施做类比：

| 系统              | 结构类比                                    |
| --------------- | --------------------------------------- |
| `MySQL`         | 表 -> 行 -> 列                             |
| `Qdrant`        | collection -> point -> vector / payload |
| `Elasticsearch` | index -> document -> field              |

一个document就是一个json
```text
{
  "id": "v_001",
  "value": "华北地区",
  "column_id": "dim_region.region_name"
}
```

`Elasticsearch` 返回结果里经常会出现一些以下划线开头的字段，例如 `_index`、`_id`、`_source`，这些属于元数据字段，属于 ES 自带的字段。

这里先做一个简要对应：

- `_index` 表示这条数据属于哪个索引
- `_id` 表示这条数据在索引中的唯一标识
- `_source` 里存放的，才是我们真正写进去的业务数据

## mapping
- `dynamic mapping`：让 `ES` 根据写入的数据自动推断字段类型
- `explicit mapping`：由我们显式定义字段结构和字段类型

从工程角度看，当前项目更适合使用 **显式定义** 的方式，因为这样更可控，也更方便我们精确设计检索行为。

## text、keyword
`mapping` 不只是定义“有哪些字段”，还要定义“字段的数据类型是什么”。而 `text` 和 `keyword`，就是 `ES` 里两种非常常见、但处理方式完全不同的字段类型。

也就是说，

1. 先有 `index`
2. `index` 里存的是 `document`
3. `document` 里有很多 `field`
4. `mapping` 要定义这些 `field` 的类型
5. 当字段类型是字符串时，最常见的两种类型就是 `text` 和 `keyword`

`text` 类型更偏**全文检索**。它适合保存一段可以被自然语言搜索的文本内容。为了支持这类搜索，`ES` 往往会先对文本做分词，再建立倒排索引。这意味着什么？意味着你存进去的不是一个“必须原样完全相等”的字符串，而是一段可以被拆开、被搜索、被匹配的文本。

例如：`"华北地区"`、`"数码品类"`、`"近三个月销售额"`。这类值如果定义成 `text`，用户在查询时不一定非得一模一样地输入整串文本，而是可以通过自然语言方式去匹配它们。

而`keyword` 更偏**精确匹配**。它不会像 `text` 那样做分词，更适合存那些“必须按原值整体处理”的字段。

例如：主键 `id`、字段标识 `column_id`、状态码、类别编码。这类值通常不是拿来做全文搜索的，而是要么相等，要么不相等，所以更适合定义成 `keyword`。

**字段类型不同，ES 后续建立索引和执行检索的方式也不同**。这正是 `mapping` 为什么重要的原因。我们并不是随便把字段声明成某个类型，而是在提前告诉 `ES`：这个字段将来打算怎么被搜索。

放到「电商问数」项目里，这个区别就非常具体了：字段取值里的 `value` 适合定义为 `text`。因为用户会用自然语言去搜它，例如“华北地区”“数码品类”。`id` 和 `column_id` 更适合定义为 `keyword`。因为它们更像结构化标识，不需要分词，只需要精确匹配。


```json
index_mappings = {
    "dynamic": False,
    "properties": {
        "id": {"type": "keyword"},
        "value": {
            "type": "text",
            "analyzer": "ik_max_word",
            "search_analyzer": "ik_max_word",
        },
        "column_id": {"type": "keyword"},
    },
}
```

## bulk
`bulk` 用来做批量写入，适合一次性写入多条文档。它的结构第一次看会有点绕，因为它采用的是“操作说明 + 数据本体”交替出现的形式。例如：

```python
await client.bulk(
    operations=[
        {"index": {"_index": "my-books"}},
        {"name": "1984", "author": "George Orwell"},
        {"index": {"_index": "my-books"}},
        {"name": "Brave New World", "author": "Aldous Huxley"},
    ],
)
```

这里的结构其实很简单：

- 先说明“我要执行一次 `index` 写入”
- 再给出“这次写入的数据”
- 然后继续下一次操作

## match
`match` 是 ES 中最常见的全文检索查询方式之一。例如：

```
await client.search(
    index="my-books",
    query={
        "match": {
            "name": "brave"
        }
    },
)
```

这段代码表达的意思是：

- 在 `my-books` 这个索引中查找
- 重点搜索 `name` 字段
- 查询词是 `brave`

ES 会根据这个查询词去做文本匹配，并返回最相关的结果。放到「电商问数」项目里，这个思路后面就会变成：在字段值索引里搜索 `value`；查询词可能是“华北地区”“数码品类”这类自然语言。