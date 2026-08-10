# 为啥使用mongodb
文档型 + 海量追加写 + 无关联查询+无事务要求
# keepalive
建立连接的时候设置now
- 客户端发消息置为0,表示续命了，之后reset
- 服务器回复ack后置位now,后续根据max-since判断是否断开连接
```go
func (c *Conn) keepalive() {  
    idleTimer := time.NewTimer(c.maxConnectionIdle)  
    defer func() {  
       idleTimer.Stop()  
    }()  
  
    for {  
       select {  
       case <-idleTimer.C:  
          c.idleMu.Lock()  
          idle := c.idle  
          if idle.IsZero() {  
             c.idleMu.Unlock()  
             idleTimer.Reset(c.maxConnectionIdle)  
             continue  
          }  
          val := c.maxConnectionIdle - time.Since(idle)  
          c.idleMu.Unlock()  
          if val <= 0 {  
             c.s.Close(c)  
             return  
          }  
          idleTimer.Reset(val)  
       case <-c.done:  
          return  
       }  
    }  
}
```
# 鉴权

1. api层鉴权
2. ws层jwt鉴权
3. kafka从redis读取token设置header

# 消息发送
sender发送消息给ws,ws发kafka异步存储消息,存储完成后回流push数据给ws,ws发消息给recv
group则是收集recvs,然后逐一发送

group和single的区别只有recvId和chatType,一个直接是groupId了
# 消息入库
insertChatLog+UpdateConv+setBitmap