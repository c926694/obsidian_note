# 协程

- G/M/P 模型：G = goroutine（协程），M = OS 线程（machine），P = processor（逻辑处理器，负责调度）。运行时把许多 G 多路复用到少量 M，通过 P 管理本地就绪队列与执行上下文。
    
- 轻量栈：goroutine 初始栈很小（KB 级），可在运行时自动伸缩（通过分配并复制栈），因此能创建大量 goroutine。
    
- 调度：每个 P 有本地运行队列，M 从其 P 上运行 G；全局队列与工作窃取用于负载均衡；当 G 做阻塞系统调用时，运行时会把 G 从当前 M 分离并安排新的 M 来继续执行其他 G。
    
- 抢占与安全点：Go 从早期的协作式演进到现在支持异步抢占（自 Go 1.14 起大幅改进），允许运行时在安全点强制抢占长时间运行的 goroutine。
    
- 与内核交互：网络和 I/O 大多由运行时的网络轮询器（epoll/kqueue 等）与非阻塞 I/O 配合，实现高并发而不阻塞 M。
    

  

  

- 抢占机制:当一个p空闲而其余p的本地队列有协程则会抢占剩余的p
    
- 分手机制:当一个p执行的协程处于阻塞，这个p剩余的协程会被新的m获取
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=NGNhMDMwN2Q5MDUxZTEwOGViMDA4NzVmNDA2MmMxZDRfNUtkWWNSOWdEaGlHczBWNXpIQmNCWkowaGE1cDNSNjRfVG9rZW46WnNKcWJ5TzJNb0dPR3F4WFhwNWN4bmRTbnZmXzE3ODI4MzU3ODM6MTc4MjgzOTM4M19WNA&add_watermark=true&scene_type=CCM)

# gomodule

**GO111MODULE**

- on:必须用module
    
- off:一定不用module
    
- auto:看情况
    

```Bash
$ go env -w GO111MODULE=on
```

**GOPROXY**

默认是https://proxy.golang.org,direct

我们可以配置国内的源，下载依赖快一点，如果国内源没有就走direct,国外源

```Bash
$ go env -w GOPROXY=https://goproxy.cn,direct
```

**GOSUMDB**

它的值是一个 Go checksum database，用于在拉取模块版本时（无论是从源站拉取还是通过 Go module proxy 拉取）保证拉取到的模块版本数据未经过篡改，若发现不一致，也就是可能存在篡改，将会立即中止。

  

GOSUMDB 的默认值为：`sum.golang.org`，在国内也是无法访问的，但是 GOSUMDB 可以被 Go 模块代理所代理（详见：Proxying a Checksum Database）。

  

因此我们可以通过设置 GOPROXY 来解决，而先前我们所设置的模块代理 `goproxy.cn` 就能支持代理 `sum.golang.org`，**就是说是跟随设置的PROXY的对应GOSUMDB,所以这一个问题在设置 GOPROXY 后，你可以不需要过度关心。**

**GOPRIVATE**

用于拉取公司内部的私有模块,类似于走中央仓库而不走远程仓库

可以搭配通配符

```Bash
go env -w GOPRIVATE=github.com/mycompany.*
```

# 泛型

## 反序列化

json反序列化的时候，会将any或者interface{}类型序列化成map

我们可以对Res对象的data用泛型处理,T∈any,在传参的时候指定T,这样反序列化就会知道具体类型

```Go
type Res[T any] struct {
    Code int    `json:"code"`
    Msg  string `json:"msg"`
    Data T      `json:"data"`
}
type UserInfo struct {
    Name string
    Age  int
}

func main() {
    userInfo := UserInfo{
       Name: "zhangsan",
       Age:  20,
    }
    res := Res[UserInfo]{
       Code: 200,
       Msg:  "ok",
       Data: userInfo,
    }
    fmt.Println(res)
    jsonByte, _ := json.Marshal(res)
    fmt.Println(string(jsonByte))
    json.Unmarshal(jsonByte, &res)
    fmt.Print(res)
}
```

## 搭配可变参数求和

```Go
func plus[T int | float32 | float64](nums ...T) T {
    total := T(0)
    for _, num := range nums {
       total += num
    }
    return total
}
func main() {
    fmt.Println(plus(1.1, 2.7))
}
```

# 异常处理

## 向上抛

业务能处理的,向上抛让调用者进行err!=nil判断

```Go
func div(a, b int) (res int, err error) {
    if b == 0 {
       err = errors.New("除数不能为0")
       return
    }
    res = a / b
    return
}
func main() {
    data, err := div(10, 0)
    if err != nil {
       fmt.Println(err)
       return
    }
    fmt.Print(data)
}
```

## 中断

只用于初始化,因为初始化失败，程序也没有执行下去的必要,于是直接发panic

```Go
func init() {
    _, err := os.ReadFile("111")
    if err != nil {
       log.Fatalln("文件读取失败")
       //panic会打印堆栈信息
       //panic("文件读取失败")
       return
    }
}
func main() {
    fmt.Print("程序继续执行")
}
```

## 捕获

通过在defer中调用recover捕获panic

```Go
func Read() {
    defer func() {
       //在defer捕获panic
       err := recover()
       if err != nil {
          //打印异常
          fmt.Println(err)
          //打印堆栈信息
          fmt.Println(string(debug.Stack()))
       }
    }()
    list := []int{1}
    fmt.Println(list[1])
}
func main() {
    Read()
    fmt.Println("程序开始")
}
```

# 文件

## 无缓冲读

```Go
file, err := os.Open("16-file/test.txt")
if err != nil {
    fmt.Println(err)
}
byteData := make([]byte, 13)
for {
    n, err := file.Read(byteData)
    if err == io.EOF {
       break
    }
    if err != nil {
       fmt.Println(err)
    }
    fmt.Print(string(byteData[:n]))
}
```

## 有缓冲按行读

```Go
file, err := os.Open("16-file/test.txt")
if err != nil {
    fmt.Println(err)
}
buf := bufio.NewReader(file)
for {
    line, _, err := buf.ReadLine()
    if err == io.EOF {
       break
    }
    fmt.Println(string(line))
}
```

# 测试

go里测试包testing,每个测试函数需要有*T指针

测试文件以_test结尾,测试函数以Test开头

## 单测

```Go
func TestAdd(t *testing.T) {
    res := add(1, -1)
    if res != 0 {
       t.Errorf("测试错误")
       return
    }
    t.Logf("测试成功，结果为：%d", res)
}
```

## 多测

t开启新的测试函数

```Go
func TestAdd1(t *testing.T) {
    t.Run("test1", func(t *testing.T) {
       if add(1, 0) != 0 {
          t.Errorf("测试错误")
          return
       }
    })
    t.Run("test2", func(t *testing.T) {
       if add(1, 1) != 2 {
          t.Errorf("测试错误")
          return
       }
    })
}
```

## 主测

主测用于给测试函数作前后准备操作

```Go
func setup() {
    fmt.Println("测试前")
}
func TestAdd2(t *testing.T) {
    fmt.Println("测试中")
}
func tearDown() {
    fmt.Println("测试后")
}
func TestMain(m *testing.M) {
    setup()
    code := m.Run()
    tearDown()
    fmt.Println("测试完成")
    os.Exit(code)
}
```

# 函数

函数签名:参数、返回值

**非自定义类型函数可以赋值给和它函数签名一致的函数变量**

gin框架中写的匿名函数就可以赋值给HandlerFunc函数

编译器会自动转换

```Go
type HandlerFunc func(*gin.Context)
router.GET("/hello", func(c *gin.Context) {})
var h HandlerFunc

h = func(c *gin.Context) {} // ✔
```

# 闭包

能够引用外部变量的函数

条件:

1. 存在函数嵌套
    
2. 外层函数返回值为内层函数
    
3. 内层函数引用外层变量
    

```Go
func outer() {
    x := 10 // 外层变量

    func inner() {
        fmt.Println(x) // 引用了外层变量 x -> 闭包产生！
    }
}
```

调用一次函数则内外层函数都被调用

```Go
r.GET("/test", func(name string) gin.HandlerFunc {
    fmt.Println("外层函数调用")
    return func(c *gin.Context) {
       fmt.Println("内层函数调用")
       c.JSON(http.StatusOK, gin.H{
          "msg": "test " + name,
       })
    }
}("xxs"))
```

# Time

## 定义及获取年月日等参数

```Go
now:= time.Now()
    fmt.Println("当前时间:", now)
    // 获取当前时间的年、月、日、时、分、秒
    fmt.Printf("年: %d, 月: %d, 日: %d, 时: %d, 分: %d, 秒: %d\n",
        now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second())
}
```

## Timestamp

时间对象.Unix转时间戳

time.Unix()时间戳转时间，第一个参数是秒整数部分，第二个参数是秒小数部分

```Go
now:= time.Now()
    fmt.Println("当前时间:", now)
    //时间戳,1970年1月1日到现在的秒数
    timestamp :=now.Unix()
    fmt.Println("时间戳:", timestamp)
    //时间戳转时间
    fmt.Println("一小时后是",time.Unix(timestamp+3600,0))
```

## Duration

time.Duration本质是time包定义的int64类型,表示两个时间的差，即时间间隔

```Go
func main(){
    fmt.Println(time.Now())
    n:=5
    //n是int类型不确定，函数参数是确定的int64类型，所以需要显示转换
    time.Sleep(time.Duration(n)*time.Second)
    fmt.Println(time.Now())
}
```

## 时间计算

add传duration得到时间

sub传时间得到duration

```Go
now:=time.Now()
    fmt.Println("当前时间:",now) 
    fmt.Println("一小时后",now.Add(time.Hour)) 
    fmt.Println("一小时前:",now.Add(-time.Hour))
    fmt.Println("时间差:",now.Add(time.Hour).Sub(now))
```

## 定时器

Tick返回一个 <- chan Time只读通道，按时间间隔发送当前时间

```Go
for tmp:=range time.Tick(time.Second){
        fmt.Println(tmp)
    }
```

## 格式化与解析

**格式化**

时间调用Format传递格式 格式化

```Go
now:=time.Now()
    fmt.Println(now.Format("2006.01.02 15.04.05"))
```

**解析**

获取时区后按layout解析字符串得到时间

```Go
date:="2006.11.23"
    // 1.获取时区
    loc,err :=time.LoadLocation("Asia/Shanghai")
    if err != nil {
        fmt.Println("Error loading location:", err)
        return
    }
    // 2.解析字符串
    t,err:=time.ParseInLocation("2006.01.02",date,loc)
    if err != nil {
        fmt.Println("Error parsing date:", err)
        return
    }
    fmt.Print(t)
```

# Context

## 根 Context

所有 Context 的起点，永远不会被取消：

```go
ctx := context.Background()   // 最常用，main 函数、初始化、顶层请求入口
ctx := context.TODO()         // 不确定用什么时占位，和 Background 一样
```

## WithCancel — 主动取消

`cancel()` 关闭 `ctx.Done()` 的 channel，所有监听方同时收到信号：

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())

    go worker(ctx, "worker-1")
    go worker(ctx, "worker-2")

    time.Sleep(2 * time.Second)
    cancel()                    // 通知所有 worker 停止
    time.Sleep(500 * time.Millisecond)
}

func worker(ctx context.Context, name string) {
    for {
        select {
        case <-ctx.Done():     // 收到取消信号
            fmt.Printf("%s: 收到退出信号，原因: %v\n", name, ctx.Err())
            return
        default:
            fmt.Printf("%s: 工作中...\n", name)
            time.Sleep(500 * time.Millisecond)
        }
    }
}
```

## WithTimeout — 超时控制

到时间自动 cancel，**defer cancel() 必须写**，防止定时器泄漏：

```go
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    result, err := callExternalAPI(ctx)
    if err != nil {
        fmt.Println("调用失败:", err)
        return
    }
    fmt.Println("结果:", result)
}

func callExternalAPI(ctx context.Context) (string, error) {
    ch := make(chan string, 1)
    go func() {
        time.Sleep(3 * time.Second)  // 模拟慢调用
        ch <- "ok"
    }()

    select {
    case res := <-ch:
        return res, nil
    case <-ctx.Done():
        return "", ctx.Err()  // context deadline exceeded
    }
}
```

## WithDeadline — 绝对时间截止

`WithTimeout` 底层就是 `WithDeadline`，两者等价：

```go
// WithTimeout 是个壳，内部直接调 WithDeadline
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
    return WithDeadline(parent, time.Now().Add(timeout))
}

// 所以以下两种写法完全等价：
ctx1, cancel1 := context.WithTimeout(ctx, 2*time.Second)
ctx2, cancel2 := context.WithDeadline(ctx, time.Now().Add(2*time.Second))
```

区别在于参数含义：

| | WithTimeout | WithDeadline |
|---|---|---|
| 参数 | **相对时间**（duration） | **绝对时间**（time.Time） |
| 通俗理解 | "超过 2 秒就取消" | "3 点之前必须完成" |
| 典型场景 | 接口超时控制（95% 的场景） | 继承上游 deadline（如 HTTP `r.Context()`） |

## WithValue — 传递请求级数据

key 用自定义类型防止不同包冲突：

```go
type ctxKey string

const (
    traceIDKey ctxKey = "trace_id"
    userIDKey  ctxKey = "user_id"
)

func main() {
    ctx := context.WithValue(context.Background(), traceIDKey, "req-12345")
    ctx = context.WithValue(ctx, userIDKey, "user-999")
    handleRequest(ctx)
}

func handleRequest(ctx context.Context) {
    traceID := ctx.Value(traceIDKey).(string)
    userID := ctx.Value(userIDKey).(string)
    fmt.Printf("处理请求: trace=%s, user=%s\n", traceID, userID)
    queryDatabase(ctx)
}

func queryDatabase(ctx context.Context) {
    traceID := ctx.Value(traceIDKey).(string)
    fmt.Printf("查询数据库: trace=%s\n", traceID)

    // 同时监听取消
    select {
    case <-time.After(100 * time.Millisecond):
        fmt.Println("查询完成")
    case <-ctx.Done():
        fmt.Println("查询被取消:", ctx.Err())
    }
}
```

## 级联取消

父 cancel → 所有子自动 cancel，不需要逐个调用：

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())

    go func() {
        ctx2, _ := context.WithCancel(ctx)
        go levelWorker(ctx2, "level-1")
    }()
    go func() {
        ctx3, _ := context.WithTimeout(ctx, 5*time.Second)
        go levelWorker(ctx3, "level-2")
    }()

    time.Sleep(1 * time.Second)
    cancel()
    time.Sleep(100 * time.Millisecond)
}

func levelWorker(ctx context.Context, name string) {
    <-ctx.Done()
    fmt.Printf("%s 收到取消: %v\n", name, ctx.Err())
}
```

## 与标准库集成

```go
req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.example.com", nil)
rows, err := db.QueryContext(ctx, "SELECT * FROM users")
```

官方库几乎都支持 Context：`net/http`、`database/sql`、`os/exec` 等。

## 最佳实践

| 规则 | 原因 |
|------|------|
| ctx 作为函数**第一个参数**，命名 `ctx` | Go 社区约定，golint 强制 |
| **不要**把 ctx 存在 struct 里 | ctx 是请求范围的，不是对象属性 |
| **不要**把 nil 当 ctx 传 | 用 `context.TODO()` 代替 |
| **务必 defer cancel()** | 泄漏定时器/goroutine |
| value 只放**元数据**，不放**业务参数** | 职责分离 |
| 自定义 key 类型**避免 key 冲突** | 不同包可能用同名 key |