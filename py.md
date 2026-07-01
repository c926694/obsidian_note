# 异步
- async定义函数为协程函数,可以异步执行
- create_task注册协程到event_loop中,由调度系统决定调度时机,一般是直接调度
- await等待可等待对象(协程函数)的结束
```py
import asyncio  
import time  
  
async def task(name):  
    await asyncio.sleep(2)  
    return name  
  
async def main():  
    s=time.time()  
    t1 = asyncio.create_task(task("A"))  
    t2 = asyncio.create_task(task("B"))  
    r1 = await t1  
    r2 = await t2  
  
    print(r1, r2)  
    print(time.time()-s)  
  
asyncio.run(main())
```