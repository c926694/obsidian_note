# https过程

```
TCP 三次握手后 → TLS 四轮握手
```

1. client发送clientHello到server,包括TLS版本、加密算法、client随机数
2. server接收clientHello,选定版本，发送ServerHello,包括server随机数、数字证书
3. client接收serverHello并用CA公钥验签数字证书,取出server公钥,加密pre-master随机数并发送给server
4. server用私钥解密得到pre-master,双方基于三个随机数生成对称加密会话密钥，建立https连接
建立连接后通过会话密钥传输信息