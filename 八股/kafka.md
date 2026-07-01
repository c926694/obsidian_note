# Kafka

## 消息不丢失

1. kafka发送消息提供acks机制
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=YmZjY2Q2ZTYyYWM4MDgwOGJkZDU5YWE1ZTY0MTFiYzZfbkNYVThvQXZ0T2o4ck8xMUlRTEREMlNjWUNrZ2cweHpfVG9rZW46RGt1QWJqbHdCb2tTSFB4emFEZWNkMzBkbmlnXzE3ODI4MzQ1MDE6MTc4MjgzODEwMV9WNA&add_watermark=true&scene_type=CCM)

2. 发送消息重试机制
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=N2U1NjYwMjZiNmNiYzgzOGM1ZTVkNTk2NjE1NzRjMjBfRlg5bnV4Vzc2ZFBJd1ZsTEd6dHlKdFdmc2pyWjh6c1lfVG9rZW46V2lEaWI0dm5wbzNRaEV4WTMyS2NnWmpRbjlnXzE3ODI4MzQ1MDE6MTc4MjgzODEwMV9WNA&add_watermark=true&scene_type=CCM)

3. 消费者手动提交partition内部的offset
    

```Go
reader.CommitMessages(ctx, msg)
```

## 消息顺序

kafka只能保证同一个partition消息消费有序有序

因为offset是存储在partition内部的，是物理存储

而topic只是逻辑分区

保证消息有序

1. 发送的消息指定partition
    

```Go
msg := kafka.Message{
    Partition: 2,
    Value:     []byte("hello"),
}
```

2. 相同的业务指定相同的key
    

```Plain
创建订单
↓

支付订单
↓

发货
↓

签收
```

```Go
msg := kafka.Message{
    Key:   []byte("order1001"),
    Value: []byte("创建订单"),
}
```

一个业务领域对应一个 Topic；这个业务领域中的多次事件都发送到同一个 Topic；Producer 使用业务对象（如 `orderID`）作为 Key，使同一个对象的消息进入同一个 Partition，从而保证该对象的消息按顺序消费。