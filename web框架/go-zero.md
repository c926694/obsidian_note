# etc/yaml
```yaml
Name: user.rpc  
ListenOn: 0.0.0.0:8080  
Etcd:  
  Hosts:  
  - 127.0.0.1:2379  
  Key: user.rpc  
  
Mysql:  
  DataSource: root:123456@tcp(127.0.0.1:3307)/user?parseTime=true  
  
Cache:  
  - Host: 127.0.0.1:6380  
    Type: node  
  
Jwt:  
  AccessSecret: cp  
  AccessExpire: 8640000
```

yaml配置的属性用config一一匹配
第一层yaml对应Config的字段名

```go
type Config struct {  
    zrpc.RpcServerConf  
  
    Mysql struct {  
       DataSource string  
    }  
  
    Cache cache.CacheConf  
  
    Jwt struct {  
       AccessSecret string  
       AccessExpire int64  
    }  
}
```
# svc设置
生成的models对象
rpc/api层需要的话要在svc层加入对应结构体
```go
type ServiceContext struct {  
    Config     config.Config  
    UsersModel models.UsersModel  
}  
  
func NewServiceContext(c config.Config) *ServiceContext {  
    sqlConn := sqlx.NewMysql(c.Mysql.DataSource)  
    return &ServiceContext{  
       Config:     c,  
       UsersModel: models.NewUsersModel(sqlConn, c.Cache),  
    }  
}
```

# api导入rpc
yaml配置rpc
```yaml
UserRpc:  
  Etcd:  
    Hosts:  
      - 127.0.0.1:2379  
    Key: user.rpc  
  
Jwt:  
  AccessSecret: cp  
  AccessExpire: 8640000
```

```go
type Config struct {  
    rest.RestConf  
    UserRpc zrpc.RpcClientConf  
    JwtAuth struct {  
       AccessSecret string  
    }  
}
```

导入rpc_client
```go
type ServiceContext struct {  
    Config config.Config  
    userclient.User  
}  
  
func NewServiceContext(c config.Config) *ServiceContext {  
    return &ServiceContext{  
       Config: c,  
       User:   userclient.NewUser(zrpc.MustNewClient(c.UserRpc)),  
    }  
}
```