# 概念

**Broker**：Kafka 服务器节点。你 Docker 里启动的 kafka 容器就是一个 broker。生产环境通常有多个 broker 组成集群。

**Topic**：消息的业务分类。比如 user_click、order_event、payment_success。消费者订阅的是 topic。

**Partition**：topic 下面的分区，消息真正存储的位置。一个 topic 可以有多个 partition，用来提高并发和吞吐。

```Plain
topic: user_click
  partition-0
  partition-1
  partition-2
```

**Message**：一条消息，包含 key、value、headers、timestamp 等。一条消息只会完整进入一个 partition，不会被拆开。

**Key**：消息的分区依据。相同 key 通常进入同一个 partition，用来保证某个业务对象的顺序，比如同一个 user_id、order_id。

Offset：消息在某个 partition 里的位置编号。Kafka 用：

```Plain
topic + partition + offset
```

定位一条消息。

**Producer**：生产者，负责发送消息到 topic。生产者根据指定 partition、key hash 或分区策略决定消息写到哪个 partition。

**Consume**r：消费者，负责从 topic 的 partition 里拉取消息。

**Consumer Group**：消费者组。同一个组内多个消费者分摊消费；不同组之间各自消费完整一份消息。

**Replica**：partition 的副本。用于高可用。副本数由 replication-factor 指定。

**Leader**：每个 partition 的主副本。生产者和消费者通常读写 leader。

**Follower**：partition 的从副本，从 leader 同步数据。leader 挂了以后，follower 可以被选为新 leader。

**ISR**：同步副本集合，In-Sync Replicas。表示当前跟 leader 数据同步比较及时的副本。

## replicas

replicas 就是 partition 的副本数量，用来做高可用和容灾。

注意：Kafka 不是给整个 topic 做一个副本，而是给 每个 partition 做副本。

## partion有序性

kafka的只保证同一个分区数据有序，不保证整体分区有序

因此,对于用户交易记录这一个topic,要保证有序就按user_ID来决定分区

## 消费者组

消息只能被同一消费者组的一个消费者消费

消息能被不同消费者组消费

比如创建订单后可能会调用消息服务、库存服务

这时不同消费者组消费同一个份消息

# 快速入门

```Go
package main

import (
  "context"
  "errors"
  "fmt"
  "time"

  "github.com/segmentio/kafka-go"
)

var (
  reader *kafka.Reader
  writer *kafka.Writer
  topic  = "user_click"
)

func NewWriter() *kafka.Writer {
    return &kafka.Writer{ 
    Addr:                   kafka.TCP("localhost:9092"), //kafka集群地址
    Topic:                  topic,                       //消息主题
    Balancer:               &kafka.Hash{},               //负载均衡策略
    RequiredAcks:           kafka.RequireNone,           //消息发送确认方式
    WriteTimeout:           1 * time.Second,             //写入超时时间
    AllowAutoTopicCreation: true,                        //是否允许创建主题
  }
}

func NewReader() *kafka.Reader {
  return kafka.NewReader(kafka.ReaderConfig{
    Brokers:        []string{"localhost:9092"},
    GroupID:        "sendMessage",
    Topic:          topic,
    CommitInterval: 1 * time.Second,
    StartOffset:    kafka.FirstOffset,
  })
}

//生产消息

func Produce(ctx context.Context) error {
  fmt.Println("开始生产", time.Now())
  for i := 0; i < 3; i++ {
    if err := writer.WriteMessages(
      ctx, kafka.Message{Key: []byte("1"), Value: []byte("我")},
      kafka.Message{Key: []byte("2"), Value: []byte("是")},
      kafka.Message{Key: []byte("3"), Value: []byte("一个")},
      kafka.Message{Key: []byte("1"), Value: []byte("测试")},
      kafka.Message{Key: []byte("2"), Value: []byte("程序")},
      kafka.Message{Key: []byte("1"), Value: []byte("！！！")},
    ); err != nil {
      if errors.Is(err, kafka.LeaderNotAvailable) {
        time.Sleep(500 * time.Millisecond)
        continue
      } else {
        break
      }
    }
  }
  fmt.Println("写入成功", time.Now())
  return nil
}

func Consume(ctx context.Context) {

  for {
    if msg, err := reader.ReadMessage(ctx); err != nil {
      fmt.Printf("读取kafka失败:%v\n", err)
      break
    } else {
      fmt.Printf("消费消息:%s\n", string(msg.Value))
      fmt.Println("消费消息", time.Now())
    }
  }
}

func main() {
  ctx := context.Background()
  writer = NewWriter()
  reader = NewReader()
  fmt.Println("当前时间",time.Now())
  go Consume(ctx)
  err := Produce(ctx)
  if err != nil {
    fmt.Printf("生产消息失败:%v\n", err)
  }
  select {}
}
```