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
