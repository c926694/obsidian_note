# 为啥使用mongodb
文档型 + 海量追加写 + 无关联查询+无事务要求
# keepalive
建立连接的时候
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