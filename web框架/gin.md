# http库实现服务器监听路由

```Go
func SayHello(w http.ResponseWriter, r *http.Request) {
    _, _ = w.Write([]byte("hello gin"))
}
func main() {
    http.HandleFunc("/hello", SayHello)
    err := http.ListenAndServe(":8080", nil)
    if err != nil {
       panic(err)
    }
}
```

# 路由

```Go
func main() {
    //创建gin的路由引擎
    r := gin.Default()
    //绑定路由和处理函数
    r.GET("/hello", func(context *gin.Context) {
       context.JSON(http.StatusOK, gin.H{
          "message": "hello gin",
       })
    })
    //默认是8080端口
    r.Run()
}
```

# 返回json

context的JSON函数用于返回响应码以及序列化的json数据,第二个参数是any类型

gin会将传入的数据进行序列化,可以是map,可以是struct

gin.H是一个map用于创建k-v结构,不过一般用struct传参即可

json序列化只会对可导出(大写字母开头)字段有效

tag标签指定的字段会优先序列化,可以使用tag来控制大小写或者字段名

```Go
type User struct {
    Msg  string `json:"msg"`
    Name string `json:"name"`
    Age  int    `json:"age"`
}
user := User{
    Msg:  "hello user",
    Name: "gin",
    Age:  18,
}
r.GET("/json", func(context *gin.Context) {
    context.JSON(http.StatusOK, user)
})
```

# 参数获取

## 获取querystring

- c.Query(key string) string 返回第一个值，找不到返回 ""。
    
- c.DefaultQuery(key, defaultValue string) string 找不到返回 defaultValue。
    
- c.GetQuery(key string) (string, bool) 返回值与是否存在（存在即便值为空字符串也算存在）
    

根据参数key获取value

```Go
r.GET("/web", func(c *gin.Context) {
    name := c.Query("name")
    age := c.Query("age")
    c.JSON(200, gin.H{
       "name": name,
       "age":  age,
    })
})
```

## 获取表单数据

通过PostForm根据key获取value

也有Default和Get前缀的函数

```Go
r.POST("/login", func(c *gin.Context) {
    username := c.PostForm("username")
    password := c.PostForm("password")
    c.JSON(200, gin.H{
       "username": username,
       "password": password,
    })
})
```

## 获取路径参数

Param获取,然后路径映射要加:前缀

```Go
r.GET("/blog/:year/:month", func(c *gin.Context) {
    year := c.Param("year")
    month := c.Param("month")
    c.JSON(200, gin.H{
       "year":  year,
       "month": month,
    })
})
```

## 数据绑定

前端传参，后端需要使用数据,需要将参数绑定到定义的结构体中

通过ShouldBind函数实现数据绑定

绑定通过反射，需要字段大写以及用tag指定前端参数字段

```Go
type UserInfo struct {
    Name string `form:"username"`
    Age  string `form:"password"`
}
r.POST("/login", func(c *gin.Context) {
    var userInfo UserInfo
    err := c.ShouldBind(&userInfo)
    if err != nil {
       c.JSON(400, gin.H{"error": err.Error()})
    } else {
       fmt.Println(userInfo)
       c.JSON(200, gin.H{
          "message": "ok",
          "name":    userInfo.Name,
          "age":     userInfo.Age,
       })
    }
})
```

# 文件上传

## 单文件

根据文件名获取文件后将文件放到指定路径即可

```Go
r.POST("/upload", func(c *gin.Context) {
    //1.获取文件
    file, err := c.FormFile("file")
    if err != nil {
       c.JSON(400, gin.H{"error": err.Error()})
    } else {
       fmt.Println(file)
       // 2.保存文件
       path := "./upload/" + file.Filename
       err = c.SaveUploadedFile(file, path)
       if err != nil {
          c.JSON(500, gin.H{"error": err.Error()})
       }
       // 3.返回响应
       c.JSON(200, gin.H{
          "message": "ok",
       })
    }
})
```

## 多文件

先获取表单然后根据name去map取文件切片

```Go
router.POST("/upload", func(c *gin.Context) {
                // Multipart form                
                form, _ := c.MultipartForm()
                files := form.File["file"]

                for index, file := range files {
                        log.Println(file.Filename)
                        dst := fmt.Sprintf("C:/tmp/%s_%d", file.Filename, index)
                        // 上传文件到指定的目录                   
                        c.SaveUploadedFile(file, dst)
                }
                c.JSON(http.StatusOK, gin.H{
                        "message": fmt.Sprintf("%d files uploaded!", len(files)),
                })
        })
```

# 路由

## 单路由

对应请求映射

```Go
r.Any("/user", func(c *gin.Context) {
    switch c.Request.Method {
    case http.MethodGet:f1
    case http.MethodPost:f2
    case http.MethodPut:f3
    case http.MethodDelete:f3
    }
})
```

## 空路由

资源不存在时返回的数据

```Go
r.NoRoute(func(c *gin.Context) {
    c.JSON(http.StatusNotFound, gin.H{
       "msg": "404 not found",
    })
})
```

## 路由组

对于统一前缀的请求,可以用路由组管理前缀

这样内部路由就不需要重复写前缀了

```Go
userGroup := r.Group("/user")
{
    userGroup.GET("/index", func(c *gin.Context) {
       c.JSON(http.StatusOK, gin.H{
          "msg": "user index",
       })
    })
    userGroup.GET("/index/hh", func(c *gin.Context) {
       c.JSON(http.StatusOK, gin.H{
          "msg": "user get index/hh",
       })
    })
    userGroup.GET("/index/tt", func(c *gin.Context) {
       c.JSON(http.StatusOK, gin.H{
          "msg": "user get index/tt",
       })
    })
    userGroup.GET("/index/xx", func(c *gin.Context) {
       c.JSON(http.StatusOK, gin.H{
          "msg": "user get index/xx",
       })
    })
}
```

# 中间件

本质是HandlerFunc函数

对于一个请求,可以在通过中间件来执行其它逻辑

## 接口调用中间件

```Go
func GetRunTime(c *gin.Context) {
    startTime := time.Now()
    c.Next()
    fmt.Println("请求耗时:", time.Since(startTime))
}
func IndexHandler(c *gin.Context) {
    fmt.Println("index")
    c.JSON(http.StatusOK, gin.H{
       "msg":  "ok",
       "name": "gin",
    })
}
func main() {
    r := gin.Default()
    r.GET("/index", GetRunTime, IndexHandler)
    r.Run(":8080")
}
```

## 注册全局中间件

一个个添加过于麻烦,可以注册为全局，执行顺序按添加的顺序

```Go
r.Use(GetRunTime)
r.GET("/index", GetRunTime, IndexHandler)
```

## 注册局部路由中间件

```Go
userGroup := r.Group("/user")
    userGroup.Use(AuthCheck("123456"))
```

## 闭包作权限校验

```Go
func AuthCheck(token string) gin.HandlerFunc {
    return func(c *gin.Context) {
       if token != "123456" {
          c.JSON(http.StatusUnauthorized, gin.H{
             "msg": "unauthorized",
          })
          c.AbortWithStatus(http.StatusUnauthorized)
       } else {
          c.Next()
       }
    }
}
```

## 默认中间件

`gin.Default()`默认使用了`Logger`和`Recovery`中间件，其中：

- `Logger`中间件将日志写入`gin.DefaultWriter`，即使配置了`GIN_MODE=release`。
    
- `Recovery`中间件会recover任何`panic`。如果有panic的话，会写入500响应码。
    

## gin中间件中使用goroutine

当在中间件或`handler`中启动新的`goroutine`时，**不能使用**原始的上下文（c *gin.Context），必须使用其只读副本（`c.Copy()`）。