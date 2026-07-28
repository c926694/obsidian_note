
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
# 绝对路径设置

```py
SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"

```
**逐层拆解：**

| 部分 | 含义 |
|------|------|
| `__file__` | 当前 `.py` 文件的路径（字符串） |
| `Path(__file__)` | 转为 `pathlib.Path` 对象 |
| `.resolve()` | 解析为**绝对路径**，消除 `..` 和符号链接 |
| `.parent` | 往上一级目录 |
| `.parent` | 再往上一级目录 |
| `/ "skills"` | 路径末尾拼接 `skills` 目录 |

**效果：** 从当前文件出发，向上两级找到 `skills/` 文件夹，得到一个**不依赖运行目录的稳定绝对路径**。常用于在项目内定位数据、配置、子模块等资源。~
```