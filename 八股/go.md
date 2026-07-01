# Slice

## 底层结构

切片是对数组的封装。实际上是一个结构体,包含三个字段:长度、容量、数组

```Go
type slice struct {
        array unsafe.Pointer // 元素指针len   
        int // 长度 cap   
        int // 容量
}
```

## 扩容机制

1.17及以前

1. 如果期望容量大于当前容量的两倍就会使用期望容量；
    
2. 如果当前切片的容量小于 1024 就会将容量翻倍；
    
3. 如果当前切片的容量大于等于 1024 就会每次增加 25% 的容量，直到新容量大于期望容量；
    

Go1.18及以后，引入了新的扩容规则：

当原slice容量(oldcap)小于256的时候，新slice(newcap)容量为原来的2倍；原slice容量超过256，新slice容量newcap = oldcap+(oldcap+3*256)/4

  =5*oldcap/4+3*64

## 切片截取

**从一个切片截取出另一个切片，修改新切片的值会影响原来的切片内容吗?**

在截取完之后，如果新切片没有触发扩容，则修改切片元素会影响原切片，如果触发了扩容则不会。

## slice作为函数参数传递

go里面一切都是值类型

**当slice作为函数参数****值传递**,函数形参是slice结构体,是值类型，**是对传入切片的值拷贝**

但是**结构体字段的数组是指针类型**,因此两者**共用同一个底层数组**,形参修改底层数组也会影响

传入的切片

**如果传入的是slice指针**,那么形参是指针,能够影响原切片字段

# Map

## 底层结构

map的就是一个hmap的结构。Go Map的底层实现是一个哈希表。它在运行时表现为一个**指向****`hmap`****结构体的指针**，`hmap`中记录了**桶数组指针****`buckets`**、**溢出桶指针**以及**元素个数等字段**。每个桶是一个**`bmap`****结构体**，**能存储8个键值对和8个****`tophash`**，并有指向下一个溢出桶的指针`overflow`。为了内存紧凑，`bmap`中采用的是先存8个键再存8个值的存储方式。

**桶数组指针指向[]bmap,每个bmap存储8个kv**

**当bmap满了后，会生成溢出桶连在当前桶的后面**

```Go
// A header for a Go map.
type hmap struct {
   count     int // map中元素个数
   flags     uint8 // 状态标志位，标记map的一些状态
   B         uint8  // 桶数以2为底的对数，即B=log_2(len(buckets))，比如B=3，那么桶数为2^3=8
   noverflow uint16 //溢出桶数量近似值
   hash0     uint32 // 哈希种子

   buckets    unsafe.Pointer // 指向buckets数组的指针
   oldbuckets unsafe.Pointer // 是一个指向buckets数组的指针，在扩容时，oldbuckets 指向老的buckets数组(大小为新buckets数组的一半)，非扩容时，oldbuckets 为空
   nevacuate  uintptr        // 表示扩容进度的一个计数器，小于该值的桶已经完成迁移

   extra *mapextra // 指向mapextra 结构的指针，mapextra 存储map中的溢出桶
}
```

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=MGM1ZDIxN2M0YmMxZWQ2OGIyMmI4OTFkNDFlZjgyNmNfc1Bka1RUWEVNR3FFVllyeUhvaDVUQXp5NlJ5dWJlYXhfVG9rZW46UmRHSGJiR3hDb200Rzd4VXgwaWN4OEg5bnBoXzE3ODI4MzM5NTg6MTc4MjgzNzU1OF9WNA&add_watermark=true&scene_type=CCM)

## map遍历顺序

Go语言里Map的遍历是**完全随机的**，并没有固定的顺序。map每次遍历,都会**从一个随机值序号的桶开始**

## map实现顺序读取

将map的key收集到slice中，并对slice排序，然后遍历slice并对key取value

```Go
func main() {
   keyList := make([]int, 0)
   m := map[int]int{
      3: 200,
      4: 200,
      1: 100,
      8: 800,
      5: 500,
      2: 200,
   }
   for key := range m {
      keyList = append(keyList, key)
   }
   sort.Ints(keyList)
   for _, key := range keyList {
      fmt.Println(key, m[key])
   }
}
```

## map是否并发安全

在查找、赋值、遍历、删除的过程中都会**检测写标志**，一旦发现**写标志已经被置位**（说明已经有 goroutine 在写），则直接 **throw**（runtime 触发 fatal error，不可被 recover 捕获）。

## map的key一定要是可比较的吗?

**是的**

操作map传入key时,map会先对key进行hash运算得到hash值

然后**根据hash值确定key所处的桶**

不同的key可能会产生**相同的hash值**,这就是哈希冲突

因此,它必须在桶内进行逐个遍历，用我们传入的Key和桶里已有的每一个Key进行**相等==**比较。这样才能确保我们操作的是正确的键值对。

先hash(key)初步确定范围,然后用key具体比较

# Channel

## CSP

核心思想:通过通信来共享内存， 而不是通过共享内存来通信

Go的goroutine就是CSP思想的经典实现

特点:

1. 避免共享内存：协程（Goroutine）不直接修改变量，而是通过 Channel 通信
    
2. 天然同步：Channel 的发送/接收自带同步机制，无需手动加锁
    
3. 易于组合：Channel 可以嵌套使用，构建复杂并发模式（如管道、超时控制）
    

## 底层结构

Channel的底层是一个名为`hchan`的结构体，核心包含几个关键组件：

**环形缓冲区**：有缓冲channel内部维护一个固定大小的环形队列，用`buf`指针指向缓冲区，`sendx`和`recvx`分别记录发送和接收的位置索引。

**两个等待队列**`sendq和recvq`：用来管理阻塞的goroutine。`sendq`存储因channel满而阻塞的发送者，`recvq`存储因channel空而阻塞的接收者(sudog)。这些队列用双向链表实现(可以实现O(1)删除中间goroutinue)，当条件满足时会唤醒对应的goroutine。

**互斥锁**：`hchan`内部有个mutex，所有的发送、接收操作都需要先获取锁，用来保证并发安全。虽然看起来可能影响性能，但Go的调度器做了优化，大多数情况下锁竞争并不激烈。

```Go
type hchan struct {
        // chan 里元素数量
        qcount   uint
        // chan 底层循环数组的长度
        dataqsiz uint
        // 指向底层循环数组的指针
        // 只针对有缓冲的 channel
        buf      unsafe.Pointer
        // chan 中元素大小
        elemsize uint16
        // chan 是否被关闭的标志
        closed   uint32
        // chan 中元素类型
        elemtype *_type // element type
        // 已发送元素在循环数组中的索引
        sendx    uint   // send index
        // 已接收元素在循环数组中的索引
        recvx    uint   // receive index
        // 等待接收的 goroutine 队列
        recvq    waitq  // list of recv waiters
        // 等待发送的 goroutine 队列
        sendq    waitq  // list of send waiters
        // 保护 hchan 中所有字段
        lock mutex
}
```

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=MzBjNWIzOGU5MDRkYWY1ZWMxYjY3OGVhYWRkNmEyMzFfMWZsN3RNYVhhRnBDZTZrejlOcFhkbWJIRDNvNjdoUU5fVG9rZW46VWZPTmJJWUx0b1JQTDh4N0ZGT2NOckhjbjBiXzE3ODI4MzM5NTg6MTc4MjgzNzU1OF9WNA&add_watermark=true&scene_type=CCM)

## 发送数据

向channel发送数据的整个过程都会在**mutex**保护下进行，保证并发安全。会经历几个关键步骤：

1. 首先是**检查是否有等待的接收者**。如果`recvq`队列不为空，说明有goroutine在等待接收数据，这时会直接把**数据传递给等待的接收者**，**跳过缓冲区**，这是最高效的路径。**同时会唤醒对应的goroutine继续执行**。
    
2. 如果**没有等待接收者**，就**尝试写入缓冲区**。检查缓冲区是否还有空间，如果`qcount < dataqsiz`，就把数据复制到`buf[sendx]`位置，然后更新`sendx`索引和`qcount`计数。这是无缓冲或缓冲区未满时的正常流径。
    
3. 当**缓冲区满了就需要阻塞等待**。创建一个`sudog`结构体**包装当前goroutine和要发送的数据**，加入到`sendq`等待队列中，然后调用`gopark`让当前goroutine进入阻塞状态，让出CPU给其他goroutine。
    

被唤醒后继续执行。当有接收者从channel读取数据后，会从`sendq`中唤醒一个等待的发送者，被唤醒的goroutine会完成数据发送并继续执行。

还有个特殊情况是向已关闭的channel发送数据会直接panic。这是Go语言的设计原则，防止向已关闭的通道写入数据。

## 读取数据

从channel读取数据也有几个关键步骤：

1. 首先**检查是否有等待的发送者**。如果`sendq`队列不为空，说明有goroutine在等待发送数据。对于无缓冲channel，会直接从发送者那里接收数据；对于有缓冲channel，会先从缓冲区取数据，然后把等待发送者的数据放入缓冲区，这样保持FIFO顺序。
    
2. 如果**没有等待发送者**，**尝试从缓冲区读取**。检查`qcount > 0`，如果缓冲区有数据，就从`buf[recvx]`位置取出数据，然后更新`recvx`索引和`qcount`计数。这是缓冲区有数据时的正常路径。
    

**缓冲区为空时需要阻塞等待**。创建`sudog`结构体包装当前goroutine，加入到`recvq`等待队列，调用`gopark`进入阻塞状态。当有发送者写入数据时会被唤醒继续执行。

从已关闭channel读取有特殊处理。如果channel已关闭且缓冲区为空，会返回零值和false标志；如果缓冲区还有数据，可以正常读取直到清空。这就是为什么`v, ok := <-ch`中的ok能判断channel状态的原因。

## 读已关闭的ch

从一个有缓冲的 channel 里读数据，当 channel 被关闭，依然能读出有效值。只有当返回的 ok 为 false 时，读出的数据才是无效的。

## channel内存泄漏

Channel引起内存泄漏最常见的是**引起goroutine泄漏**从而导致的**间接内存泄漏**，当goroutine阻塞在channel操作上永远无法退出时，**goroutine本身和它引用的所有变量都无法被GC回收**。比如一个goroutine在等待接收数据，但发送者已经退出了，这个接收者就会永远阻塞下去。或者select语句使用不当，在没有default分支的select中，如果所有case都无法执行，goroutine会永远阻塞。出现内存泄漏

## channel关闭

试图**重复关闭一个channel**、，关闭一个**nil值的channel**、关闭**只有一个接收方向的channel**都将导致panic异常。

往**已关闭的channel**写入数据会直接panic。

## Select

select是Go语言专门为**channel操作**设计的**多路复用控制结构**，类似于网络编程中的select系统调用。

核心作用是**同时监听多个channel操作**。当有多个channel都可能有数据收发时，select能够**选择其中一个可执行的case**进行操作，而**不是按顺序逐个尝试**。比如**同时监听数据输入、超时信号、取消信号**等。

## select执行机制

**Case 的执行时机指的是channel不阻塞(有ch读或写),如果case的channel都阻塞，那么select也就阻塞，直到有case匹配上,然后select执行完毕**

select的执行机制是**随机选择**。Go会从**多个case之间随机选择**一个进行匹配，这避免了饥饿问题。如果没有case能执行就会执行default，如果没有default，**当前goroutine会阻塞等待,直到有case匹配**

**case data := <-ch(nil) ,读nil ch会使case失效,select不会去匹配**

让case失效进而实现select阻塞可以减少cpu空转

```Go
select {
case data := <-ch1:
    // 处理ch1的数据
case ch2 <- value:
    // 向ch2发送数据  
case <-timeout:
    // 超时处理
default:
    // 所有channel都不可用时执行
}
```

# defer

defer执行顺序和调用顺序相反，类似于栈后进先出(LIFO)

defer 的作用是：当 defer 语句被执行时，跟在 defer 后面的函数会被延迟执行。直到 包含该 defer 语句的函数执行完毕时，defer 后的函数才会被执行，不论包含 defer 语句的函数是通过 return 正常结束，还是由于 panic 导致的异常

- defer语句经常被用于处理成对的操作，如打开、关闭、连接、断开连接、 加锁、释放锁。
    
- 通过defer机制，不论函数逻辑多复杂，都能保证在任何执行路径下，资 源被释放。
    
- 释放资源的defer应该直接跟在请求资源的语句后。
    

# Sync

## 原子操作实现

Go语言实现原子操作，其根本是**依赖底层CPU硬件提供的原子指令**

## 原子操作和锁的区别

原子操作和锁最核心的区别在于它们的实现层级和保护范围。

**原子操作**是**CPU硬件层面的"微观"**机制，它保证对**单个数据**（通常是整型或指针）的**单次读改写操作是绝对不可分割的，性能极高**，因为它不涉及操作系统内核的介入和goroutine的挂起。

**锁**则是**操作系统或语言运行时提供的"宏观"**机制，它保护的是一个**代码块（临界区），而不仅仅是单个变量**。当获取锁失败时，它会让**goroutine休眠**，而不是空耗CPU。虽然锁的开销远大于原子操作，但它能**保护一段复杂的、涉及多个变量的业务逻辑**。

所以，对于简单的计数器或标志位更新，用原子操作追求极致性能；

而只要需要保护一段逻辑或多个变量的一致性，就必须用锁。

## mutex状态

Go的`Mutex`主要有两种模式：正常模式（Normal Mode）和饥饿模式（Starvation Mode）。

1. 正常模式：这是**默认模式**，讲究的是性能。**新请求锁的goroutine会和等待队列头部的goroutine竞争**，新来的goroutine有几次"自旋"的机会，如果在此期间锁被释放，它就可以直接抢到锁。这种方式吞吐量高，但可能会导致队列头部的goroutine等待很久，即"**不公平**"。
    
2. 饥饿模式：**当一个 goroutine 在等待队列中等待超过 1 毫秒（1ms）后，Mutex 就会切换到此模式**，讲究的是**公平**。在此模式下，**锁的所有权**会直接从**解锁的goroutine移交给等待队列的头部**，新来的goroutine不会自旋，必须排到队尾。这样可以确保队列中的等待者不会被"饿死"。
    

当等待队列为空，或者一个goroutine拿到锁时发现它的等待时间小于1ms，饥饿模式就会结束，切换回正常模式。这两种模式的动态切换，是Go在性能和公平性之间做的精妙平衡。

## mutex和rwmutex

|   |   |   |
|---|---|---|
|对比维度|sync.Mutex（互斥锁）|sync.RWMutex（读写锁）|
|锁的性质|全排他锁，读写都互斥|读共享、写排他|
|并发度|极低，临界区完全串行|读操作可并发，并发度更高|
|适用场景|读写频繁、写占比高、临界区很小|读多写少（如缓存、配置、字典）|
|性能开销|锁管理开销小|内部维护读计数，锁本身开销略大|
|写饥饿风险|无（全排队）|原生做了写优先优化，避免写被读长期阻塞|
|典型使用|计数器、状态修改、短小临界区|配置读取、缓存查询、元数据访问|

## 在mutex上自旋的goroutine会浪费资源吗?

首先，自旋不是无休止的空转，它有严格的**次数**和**时间**限制，通常只持续**几十纳秒**。其次，自旋仅仅在特定条件下才会发生，比如**CPU核数大于1**，并且**当前机器不算繁忙**（没有太多goroutine在排队）

## Sync.once的作用和底层原理

`sync.Once`的作用是**确保一个函数在程序生命周期内**，无论在多少个goroutine中被调用，都**只会被执行一次**。它常用于**单例对象的初始化**或一些**只需要执行一次的全局配置加载**

核心依赖一个`uint32`的`done`标志位和一个互斥锁`Mutex`，

```Go
type Once struct {
    done uint32  // 标识位
    m    Mutex
}
```

当`Once.Do(f)`首次被调用时：

1. 它首先会通过原子操作（`atomic.LoadUint32`）快速检查`done`标志位。如果`done`为1，说明初始化已完成，直接返回，这个路径完全无锁，开销极小。
    
2. 如果`done`为0，说明可能是第一次调用，这时它会进入一个慢路径（`doSlow`）。
    
3. 在慢路径里，它会先加锁，然后再次检查`done`标志位。这个"**双重检查**"（Double-Checked Locking）是关键，它防止了在多个goroutine同时进入慢路径时，函数`f`被重复执行。
    
4. 如果此时`done`仍然为0，那么当前goroutine就会执行传入的函数`f`。执行完毕后，它会通过原子操作（`atomic.StoreUint32`）将`done`标志位置为1，最后解锁。
    

之后任何再调用`Do`的goroutine，都会在第一步的原子`Load`操作时发现`done`为1而直接返回。整个过程结合了原子操作的速度和互斥锁的安全性，高效且线程安全地实现了"仅执行一次"的保证

## waitGroup怎样实现协程等待

`WaitGroup`实现等待，本质上是一个**原子计数器**和一个**信号量**的协作。

调用`Add`会增加计数值，`Done`会减计数值。而`Wait`方法会检查这个计数器，如果不为零，就利用信号量将当前goroutine高效地挂起。直到最后一个`Done`调用将计数器清零，它就会通过这个信号量，一次性唤醒所有在`Wait`处等待的goroutine，从而实现等待目的。

## sync.map底层原理

`sync.Map`的底层核心是"**空间换时间**"，通过**两个Map**（**`read`**和**`dirty`**）的冗余结构，实现"读写分离"，最终达到针对特定场景的"读"操作无锁优化。

它的`read`是一个只读的`map`，提供无锁的并发读取，速度极快。写操作则会先操作一个加了锁的、可读写的`dirty` map。当`dirty` map的数据积累到一定程度，或者`read` map中miss key达到一定数量时，`sync.Map`会将`dirty` map里的数据"晋升"并覆盖掉旧的`read` map，完成一次数据同步。

## sync.Map 适用的场景？

`sync.Map`适合读多写少的场景，而不是适合写多读少的场景。

因为我们期望将更多的流量在read map这一层进行拦截，从而避免加锁访问dirty map 对于更新，删除，读取，read map可以尽量通过一些原子操作，让整个操作变得无锁化，这样就可以避免进一步加锁访问dirty map。倘若写操作过多，sync.Map 基本等价于一把互斥锁 + map，其读写效率会大大下降

# Context

## context是啥

go语言里的context实际上是一个接口，提供了**Deadline()，Done()，Err()以及Value()四种方法**。它在Go 1.7 标准库被引入。

它本质上是一个**信号传递**和**范围控制**的工具。它的核心作用是在一个**请求处理链路中**（跨越多个函数和goroutine），优雅地传递**取消信号**（cancellation）、**超时**（timeout）和**截止日期**（deadline），并能**携带一些范围内的键值对数据**。

## context作用

Go的Context主要解决三个核心问题：**超时控制**、**取消信号传播**和**请求级数据传递**

在实际项目中，我们最常用的是超时控制。比如一个HTTP请求需要调用多个下游服务，我们通过`context.WithTimeout`设置整体超时时间，**当超时发生时，所有子操作都会收到取消信号并立即退出，避免资源浪费**。**取消信号的传播是通过Context的层级结构实现的**，父Context取消时，所有子Context都会自动取消。

另外**Context还能传递请求级的元数据，比如用户ID、请求ID**等，这在分布式链路追踪中特别有用。需要注意的是，Context应该作为函数的第一个参数传递，不要存储在结构体中，并且传递的数据应该是请求级别的，不要滥用。

## context.Value查找过程

Context.Value的查找过程是一个**链式递归查找**的过程，**从当前Context开始**，沿着**父Context链一直向上查找直到找到对应的key或者到达根Context**。

具体流程是：当调用`ctx.Value(key)`时，首先检查当前Context是否包含这个key，如果当前层没有，就会调用`parent.Value(key)`继续向上查找。这个过程会一直递归下去，直到找到匹配的key返回对应的value，或者查找到根Context返回nil。

## context如何被取消

Context的取消是通过channel关闭信号实现的，主要有三种取消方式。

首先是**主动取消**，通过`context.WithCancel`创建的Context会返回一个cancel函数，调用这个函数就会关闭内部的done channel，所有监听这个Context的goroutine都能通过`ctx.Done()`收到取消信号。

其次是**超时取消**，`context.WithTimeout`和`context.WithDeadline`会启动一个定时器，到达指定时间后自动调用cancel函数触发取消。

最后是**级联取消**，当父Context被取消时，所有子Context会自动被取消，这是通过Context树的结构实现的。

# gmp模型

## gmp是啥?

GMP是Go运行时的核心调度模型

GMP含义：G是goroutine协程；M是machine系统线程，真正干活的；P是processor，逻辑处理器，它是G和M之间的桥梁。它负责调度G

调度逻辑是这样的，**M必须绑定P才能执行G**。每个**P维护一个自己的本地G队列（长度256）**，**M从P的本地队列取G执行**。当本地队列空时，M会**按优先级**从**全局队列**、**网络轮询器**、**其他P队列**中窃取goroutine，这是**work-stealing**机制。

就是这个模型让Go能在少量线程上调度海量goroutine，是Go高并发的基础。

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=OWM1MzQzY2RlODQxMGIyYmYxOTQyMjI4YTQ1NDVjN2ZfdmRRUXRxajlsVjRvMWtocTBHTE1sS0h6aEswd3I5VFRfVG9rZW46WHhJbWJGVjFQb28yaE54TlVsMGN2U3Y1bnpiXzE3ODI4MzM5NTg6MTc4MjgzNzU1OF9WNA&add_watermark=true&scene_type=CCM)

## Go scheduler

Go scheduler就是Go运行时的**协程调度器**，负责**在系统线程上调度执行goroutine**。它 是 Go runtime 的一部分，它内嵌在 Go 程序里，和 Go 程序一起运行。它的主要工作是决定哪个goroutine在哪个线程上运行，以及何时进行上下文切换。

Go scheduler:总的调度系统

p:调度系统的数据结构/执行资源

## 调度策略

让运行了10ms的g让出m并放到队列中,让m执行下一个g

- **sysmon** 是 Go runtime 启动的**后台监控线程**。它不需要绑定 P，所以即使所有 P 都被忙碌的 goroutine 占住了，sysmon 仍然能跑。
    

当 sysmon 发现 M 已运行同一个 G（Goroutine）**10ms** 以上时，它会将该 G 的内部参数 `preempt` 设置为 true，表示需要被抢占，让出CPU了

**go1.14之前**是**协作式抢占**

runtime 发出提醒

G 得自己走到检查点

然后配合让出M

这种方式如果是for{}会无法让出m

go1.14之后是**基于信号的异步抢占**

sysmon 向运行 G 的 M发送信号（SIGURG）。Go 的信号处理程序会调用M上的一个叫作 gsignal 的 goroutine 来处理该信号，并使其检查该信号。gsignal 看到抢占信号，停止正在运行的 G。此过程是安全的

## 调度时机

- 等待读取或写入未缓冲的通道
    
- 由于 time.Sleep() 而等待
    
- 等待互斥量释放
    
- 发生系统调用
    

## m寻找p过程

M会**优先检查本地队列**（LRQ）：从当前P的LRQ里`runqget`一个G。（**无锁CAS**），如果本地队列没有可运行G，**再次检查全局队列**（GRQ）去全局队列里`globrunqget`找。（需要加锁）；如果还没有，就**检查网络轮询器**（netpoll），就去`netpoll`里**看看有没有因为网络IO就绪的G**。（非阻塞模式），依然没有获取到可运行G，则会**从别的P偷（steal work）**，这个偷的过程是**随机找一个别的P**，从它的LRQ里**偷一半的G**过来。

## GMP能不能去掉P层?

不能，这会导致性能问题

**掉P的后果**：如果直接变成GM模型，**所有M都需要从全局队列中获取goroutine**，这就**需要全局锁保护**。在高并发场景下，**大量M争抢同一把锁会造成严重的锁竞争**，CPU大部分时间都浪费在等锁上，调度效率急剧下降。

**P层的价值**：**P**的存在**实现了无锁的本地调度**。每个P**维护独立的本地队列**，M绑定P后可以直接从本地队列取G执行，**大部分情况下都不需要全局锁**。只有本地队列空了才去偷取，这大大减少了锁竞争。

# 内存管理

## go咋进行内存分配的?

核心是**分级分配**和**本地缓存**。

分配器架构：Go内存分配有三个层级：**mcache（线程缓存）**、**mcentral（中央缓存）**、**mheap（页堆）**。**每个P都有独立的mcache**，避免了锁竞争；**mcentral按对象大小分类管理**；**mheap负责从操作系统申请大块内存**。

对象分类分配：根据对象大小分为三类处理：

- **微小对象**（<16字节）：在**mcache**的tiny分配器中分配，多个微小对象可以共享一个内存块
    
- **小对象**（16字节-32KB）：通过size class机制，预定义了67种大小规格，优先从**P的mcache**对应的mspan中分配，如果 mcache 没有内存，则从 **mcentral** 获取，如果 mcentral 也没有，则向 **mheap** 申请，如果 mheap 也没有，则从**操作系统申请内存**。
    
- **大对象**（>32KB）：直接从**mheap**分配，跨越多个页面
    

## 内存逃逸时机

内存逃逸是编译器在程序编译时期根据逃逸分析策略，将**原本应该分配到栈上的对象分配到堆上**的一个过程

主要逃逸场景：

- 返回局部变量指针：函数返回内部变量的地址，变量必须逃逸到堆上
    
- interface{}类型：传递给interface{}参数的具体类型会逃逸，因为需要运行时类型信息
    
- 闭包引用外部变量：被闭包捕获的变量会逃逸到堆上
    
- 切片/map动态扩容：当容量超出编译期确定范围时会逃逸
    
- 大对象：超过栈大小限制的对象直接分配到堆上
    

## 内存逃逸影响

因为堆对象需要垃圾回收机制来释放内存，栈对象会跟随函数结束被编译器回收

所以**大量的内存逃逸会给gc带来压力**

## 常见内存泄漏场景

**goroutine泄漏**：这是最常见的泄漏场景。**goroutine没有正常退出会一直占用内存**，比如**从channel读取数据但channel永远不会有数据写入**，或者**死循环没有退出条件**。我在项目中遇到过，启动了处理任务的goroutine但没有合适的退出机制，导致随着请求增加goroutine越来越多。

**channel泄漏**：**未关闭的channel**和等待**channel的goroutine会相互持有引用**。比如生产者已经结束但没有关闭channel，消费者goroutine会一直阻塞等待，造成内存无法回收。

**slice引用大数组**：当slice引用一个大数组的小部分时，整个底层数组都无法被GC回收。解决方法是使用copy创建新的slice。

**map元素过多**：map中删除元素只是标记删除，底层bucket不会缩减。如果map曾经很大后来元素减少，内存占用仍然很高。

**定时器未停止**：`time.After`或`time.NewTimer`创建的定时器如果不手动停止，会在heap中持续存在。

**循环引用**：虽然Go的GC能处理循环引用，但在某些复杂场景下仍可能出现问题。