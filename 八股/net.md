# https过程

```
TCP 三次握手后 → TLS 四轮握手
```

1. client发送clientHello到server,包括TLS版本、加密算法、client随机数
2. server接收clientHello,发送