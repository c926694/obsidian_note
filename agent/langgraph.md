# 概述
- `StateGraph(MessagesState)` — 创建一个有状态的图
- `add_node(mock_llm)` — 注册节点（函数名自动作为节点名 `"mock_llm"`）
- `add_edge(START, "mock_llm")` — 入口边：流程开始后进入 `mock_llm`
- `add_edge("mock_llm", END)` — 出口边：`mock_llm` 执行完后结束流程
```py
from langgraph.graph import StateGraph, MessagesState, START, END  
  
def mock_llm(state: MessagesState):  
    return {"messages": [{"role": "ai", "content": "hello world"}]}  
  
graph = StateGraph(MessagesState)  
graph.add_node(mock_llm)  
graph.add_edge(START, "mock_llm")  
graph.add_edge("mock_llm", END)  
graph = graph.compile()  
  
res=graph.invoke({"messages": [{"role": "user", "content": "hi!"}]})  
print(res["messages"][-1].content)
```
# 快速开始
## 模型和工具定义
```py
import os  
  
from langchain.tools import tool  
from langchain.chat_models import init_chat_model  
from dotenv import load_dotenv  
  
load_dotenv(override=True)  
  
model = init_chat_model(  
    model=f"openai:{os.getenv('MODEL_NAME')}",  
    api_key=os.getenv('OPENAI_API_KEY'),  
    base_url=os.getenv("BASE_URL"),  
    temperature=0  
)  
  
  
# 定义工具  
@tool  
def multiply(a: int, b: int) -> int:  
    """将`a`和`b`相乘。  
  
    参数：  
        a: 第一个整数  
        b: 第二个整数  
    """    return a * b  
  
  
@tool  
def add(a: int, b: int) -> int:  
    """将`a`和`b`相加。  
  
    参数：  
        a: 第一个整数  
        b: 第二个整数  
    """    return a + b  
  
  
@tool  
def divide(a: int, b: int) -> float:  
    """将`a`除以`b`。  
  
    参数：  
        a: 第一个整数  
        b: 第二个整数  
    """    return a / b  
  
  
# 增强LLM的工具能力  
tools = [add, multiply, divide]  
tools_by_name = {tool.name: tool for tool in tools}  
model_with_tools = model.bind_tools(tools)
```
## 状态
```py
from langchain.messages import AnyMessage  
from typing_extensions import TypedDict, Annotated  
import operator  
  
  
class MessagesState(TypedDict):  
    messages: Annotated[list[AnyMessage], operator.add]  
    llm_calls: int
```
## 模型节点
```py
from langchain.messages import SystemMessage  
  
  
def llm_call(state: dict):  
    """LLM决定是否调用工具"""  
  
    return {  
        "messages": [  
            model_with_tools.invoke(  
                [  
                    SystemMessage(  
                        content="你是一个有用的助手，负责对一组输入执行算术运算。"  
                    )  
                ]  
                + state["messages"]  
            )  
        ],  
        "llm_calls": state.get('llm_calls', 0) + 1  
    }
```
## 工具节点
```py
from langchain.messages import ToolMessage  
  
  
def tool_node(state: dict):  
    """执行工具调用"""  
  
    result = []  
    for tool_call in state["messages"][-1].tool_calls:  
        tool = tools_by_name[tool_call["name"]]  
        observation = tool.invoke(tool_call["args"])  
        result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))  
    return {"messages": result}
```
## 条件边
```py
from typing import Literal  
from langgraph.graph import StateGraph, START, END  
  
  
def should_continue(state: MessagesState) -> Literal["tool_node", END]:  
    """决定是否继续循环或停止，基于LLM是否进行了工具调用"""  
  
    messages = state["messages"]  
    last_message = messages[-1]  
  
    # 如果LLM进行了工具调用，则执行操作  
    if last_message.tool_calls:  
        return "tool_node"  
  
    # 否则，我们停止（回复用户）  
    return END
```
## 编译运行
```py
# 构建工作流  
agent_builder = StateGraph(MessagesState)  
  
# 添加节点  
agent_builder.add_node("llm_call", llm_call)  
agent_builder.add_node("tool_node", tool_node)  
  
# 添加边连接节点  
agent_builder.add_edge(START, "llm_call")  
agent_builder.add_conditional_edges(  
    "llm_call",  
    should_continue,  
    ["tool_node", END]  
)  
agent_builder.add_edge("tool_node", "llm_call")  
  
# 编译代理  
agent = agent_builder.compile()  
  
# 显示代理  
from IPython.display import Image, display  
display(Image(agent.get_graph(xray=True).draw_mermaid_png()))  
  
# 调用  
from langchain.messages import HumanMessage  
messages = [HumanMessage(content="3加4等于多少。")]  
messages = agent.invoke({"messages": messages})  
for m in messages["messages"]:  
    m.pretty_print()
```
![[Pasted image 20260710103443.png]]
# 中断 (Interrupt)

interrupt 让图执行到某个节点时暂停，等外部回复后再继续。

## 必须条件

- 必须有 `checkpointer`（记忆检查点）
- 必须有 `thread_id`（标识同一会话，续跑时用同一个）

```py
checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)

config = {"configurable": {"thread_id": "order-1"}}
```

## 最简单的例子

```py
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver

class State(TypedDict):
    items: list[str]
    approved: bool
    msg: str

def add_item(state: State):
    return {"items": ["咖啡"]}

def ask_approve(state: State):
    # ★ 这里停住，等外面给答案
    answer = interrupt("订单有咖啡，是否批准？")
    return {"approved": answer}     # interrupt("") 返回的就是外部传的值

def process(state: State):
    if state["approved"]:
        return {"msg": "已处理"}
    return {"msg": "已取消"}

# 构建图
builder = StateGraph(State)
builder.add_node(add_item)
builder.add_node(ask_approve)
builder.add_node(process)
builder.add_edge(START, "add_item")
builder.add_edge("add_item", "ask_approve")
builder.add_edge("ask_approve", "process")
builder.add_edge("process", END)

checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)

# ===== 运行 =====
config = {"configurable": {"thread_id": "order-1"}}

# 第1次 invoke：跑到 interrupt 停住，返回暂停前的 state
res1 = graph.invoke({"items": [], "approved": False, "msg": ""}, config)
print("第1次返回:", res1)
# → 第1次返回: {'items': ['咖啡'], 'approved': False, 'msg': ''}
#   add_item 跑完了，ask_approve 还没跑（interrupt停住了）

# 第2次 invoke：传 False（拒绝），从断点继续跑完
res2 = graph.invoke(Command(resume=False), config)
print("第2次返回:", res2)
# → 第2次返回: {'items': ['咖啡'], 'approved': False, 'msg': '已取消'}

# ===== 另一个会话：批准 =====
config2 = {"configurable": {"thread_id": "order-2"}}
graph.invoke({"items": [], "approved": False, "msg": ""}, config2)
res = graph.invoke(Command(resume=True), config2)
print("批准:", res)
# → 批准: {'items': ['咖啡'], 'approved': True, 'msg': '已处理'}
```

## 中断流程

> **第1次 `invoke` → 跑到 `interrupt` 图终止 → 第2次 `invoke(Command(resume=值))` → `interrupt()` 返回那个值 → 节点拿到值继续执行。**

```
第1次 invoke ──→ ... → interrupt("提示语")
                                │
                           图终止，返回中间态
                                │
                     你决定 resume=True / False
                                │
第2次 invoke(Command(resume=X)) ──→ interrupt() 返回 X
                                │
                      answer = X → 继续往下跑 → END
```

## Command.resume 传给 interrupt

```python
# 图里
answer = interrupt("订单有咖啡，是否批准？")
#           ↑
#           ↓
# 外部
graph.invoke(Command(resume=True), config)
#              ↑ True 传给 interrupt，interrupt 返回 True
#              所以 answer = True
```

| 外部传 | `interrupt()` 返回 | `approved` | 最终结果 |
|--------|-------------------|-----------|---------|
| `Command(resume=True)` | `True` | `True` | 已处理 |
| `Command(resume=False)` | `False` | `False` | 已取消 |

# 工作流
```py
from typing import Annotated
from langgraph.graph import StateGraph, START, END
from langgraph.types import StateGraph
from pydantic import BaseModel, Field
from typing_extensions import TypedDict, Literal
from operator import add

# 定义图状态
class State(TypedDict):
    joke: str
    topic: str
    punchline: str
    needs_improvement: bool

# 定义用于评估笑话的结构化输出模型
class PunchlineEvaluation(BaseModel):
    needs_improvement: bool = Field(
        description="判断笑话是否需要改进。如果笑点明显或平庸，返回 true。"
    )

# 使用结构化输出增强 LLM
evaluator = llm.with_structured_output(PunchlineEvaluation)

# 节点

def generate_joke(state: State):
    """生成一个关于给定主题的笑话"""
    joke = llm.invoke(f"写一个关于 {state['topic']} 的笑话")
    return {"joke": joke.content}

def check_punchline(state: State):
    """检查笑话是否需要改进"""
    evaluation = evaluator.invoke(f"评估这个笑话的笑点: {state['joke']}")
    return {"needs_improvement": evaluation.needs_improvement}

def improve_joke(state: State):
    """改进笑话"""
    improved_joke = llm.invoke(f"改进这个笑话，使其更有趣: {state['joke']}")
    return {"joke": improved_joke.content}

def polish_joke(state: State):
    """润色笑话，确保质量"""
    polished_joke = llm.invoke(f"润色这个笑话，使其更加完美: {state['joke']}")
    return {"joke": polished_joke.content}

# 条件边函数，根据笑话是否需要改进来决定路由

def should_improve_joke(state: State):
    """根据笑话是否需要改进来决定路由"""
    if state["needs_improvement"]:
        return "improve_joke"
    else:
        return "polish_joke"

# 构建工作流
workflow_builder = StateGraph(State)

# 添加节点
workflow_builder.add_node("generate_joke", generate_joke)
workflow_builder.add_node("check_punchline", check_punchline)
workflow_builder.add_node("improve_joke", improve_joke)
workflow_builder.add_node("polish_joke", polish_joke)

# 添加边来连接节点
workflow_builder.add_edge(START, "generate_joke")
workflow_builder.add_edge("generate_joke", "check_punchline")
workflow_builder.add_conditional_edges(
    "check_punchline",
    should_improve_joke,
    {  # 由 should_improve_joke 返回的值 : 要访问的下一个节点的名称
        "improve_joke": "improve_joke",
        "polish_joke": "polish_joke"
    }
)
workflow_builder.add_edge("improve_joke", "polish_joke")
workflow_builder.add_edge("polish_joke", END)

# 编译工作流
workflow = workflow_builder.compile()

# 显示工作流
from IPython.display import display, Image
display(Image(workflow.get_graph().draw_mermaid_png()))

# 调用
state = workflow.invoke({"topic": "编程"})
print(state["joke"])
```
# 状态回溯
**不改图的结构，只改 State 的数据**
## 获取节点列表
```py
# 状态以倒序时间顺序返回。
states = list(graph.get_state_history(config))

for state in states:
    print(state.next)
    print(state.config["configurable"]["checkpoint_id"])
    print()
```
## 获取节点
```py
# 这是倒数第二个状态（状态按时间顺序列出）
selected_state = states[1]
print(selected_state.next)
print(selected_state.values)
```
## 更新状态
`update_state` 将创建一个新的检查点。新检查点将与同一线程关联，但会有一个新的检查点ID。
```py
new_config = graph.update_state(selected_state.config, values={"topic": "chickens"})
print(new_config)

graph.invoke(None, new_config)
```
# edge
## 条件边
条件函数返回的字符串用作条件跳转的字典key
```py
from typing import Literal

def route_order(state) -> Literal["urgent", "normal", "vip"]:
    """
    根据订单类型路由到不同节点
    返回值用语义化的名字，不用和节点名一致
    """
    if state["is_vip"]:
        return "vip"        # 语义化返回值
    if state["is_urgent"]:
        return "urgent"
    return "normal"         # 普通订单

add_conditional_edges("classify", route_order, {
    "vip": "vip_handler",      # "vip" → 去 vip_handler 节点
    "urgent": "fast_track",     # "urgent" → 去 fast_track 节点
    "normal": "standard_queue"  # "normal" → 去 standard_queue 节点
})

```
## Send
用于将多个任务分配给同一节点并行处理

| 概念 | 说明 |
|------|------|
| `Send(节点名, state)` | 派一个任务去指定节点，带一份独立的 state |
| 返回类型 | `list[Send]` — 每有一个 Send 就启动一个并行任务 |
| 条件边配合 | `add_conditional_edges(源, 函数, [目标节点])` |
| 归约器 | 并行任务写同一个字段时**必须**加 `operator.add`，否则覆盖 |
| 用途 | 动态数量并行：处理多个文档、搜索多个来源、评估多个选项 |


```py
from langgraph.graph import StateGraph, START, END, Send
from typing import Annotated, TypedDict
import operator

class State(TypedDict):
    tasks: list[str]
    results: Annotated[list[str], operator.add]

def dispatcher(state: State):
    """根据 tasks 列表，每个 task 派一个 worker"""
    return [
        Send("worker", {"task": t})    # ← 参数1: 目标节点名
        for t in state["tasks"]        #   参数2: 传给该节点的 state
    ]

def worker(state):
    """每个 worker 只处理自己的 task"""
    result = f"完成: {state['task']}"
    return {"results": [result]}

builder = StateGraph(State)
builder.add_node(dispatcher)
builder.add_node(worker)
builder.add_edge(START, "dispatcher")
builder.add_conditional_edges("dispatcher", dispatcher, ["worker"])
builder.add_edge("worker", END)

graph = builder.compile()

res = graph.invoke({"tasks": ["买菜", "做饭", "洗碗"], "results": []})
print(res["results"])
# → ['完成: 买菜', '完成: 做饭', '完成: 洗碗']

```

# 子图 

## 父图与子图共享 State 的消息重复问题
子图返回的是完整 state（含继承来的消息），父图又用 `operator.add` 追加了一次

当父图和子图使用**同一个带 `operator.add` 的 State**时，消息会重复
1. 父图 invoke → 父图 state: ["hello subgraph"]
2. 父图把完整 state 传给子图 → 子图收到: ["hello subgraph"]
3. 子图 sub_node_1 返回 ["response from subgraph"]
   子图内部 operator.add → ["hello subgraph"] + ["response from subgraph"]
   子图返回: ["hello subgraph", "response from subgraph"]
4. 父图用 operator.add 合并子图返回值:
   ["hello subgraph"] + ["hello subgraph", "response from subgraph"]
   = ["hello subgraph", "hello subgraph", "response from subgraph"]

```py
from operator import add
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    messages: Annotated[list[str], add]

# 子图
def sub_node_1(state: State):
    return {"messages": ["response from subgraph"]}

subgraph_builder = StateGraph(State)
subgraph_builder.add_node("sub_node_1", sub_node_1)
subgraph_builder.add_edge(START, "sub_node_1")
subgraph_builder.add_edge("sub_node_1", END)
subgraph = subgraph_builder.compile()

# 父图
builder = StateGraph(State)
builder.add_node("subgraph_node", subgraph)
builder.add_edge(START, "subgraph_node")
builder.add_edge("subgraph_node", END)
graph = builder.compile()

print(graph.invoke({"messages": ["hello subgraph"]}))
# → {'messages': ['hello subgraph', 'hello subgraph', 'response from subgraph']}
#   "hello subgraph" 重复了！
```


## 解决方案：父图和子图用不同的 State

```py
# 父图 State
class ParentState(TypedDict):
    messages: Annotated[list[str], add]

# 子图 State — 不加归约器，覆盖而非追加
class SubState(TypedDict):
    messages: list[str]

def sub_node_1(state: SubState):
    return {"messages": ["response from subgraph"]}

subgraph_builder = StateGraph(SubState)
subgraph_builder.add_node("sub_node_1", sub_node_1)
subgraph_builder.add_edge(START, "sub_node_1")
subgraph_builder.add_edge("sub_node_1", END)
subgraph = subgraph_builder.compile()

builder = StateGraph(ParentState)
builder.add_node("subgraph_node", subgraph)
builder.add_edge(START, "subgraph_node")
builder.add_edge("subgraph_node", END)
graph = builder.compile()

print(graph.invoke({"messages": ["hello subgraph"]}))
# → {'messages': ['hello subgraph', 'response from subgraph']}  ✅ 不重复
```
# Command

`Command` 是 LangGraph 的**指令对象**，用于在节点内或外部控制图的行为。

| 用法 | 说明 | 位置 |
|------|------|------|
| `Command(resume=值)` | 从中断恢复，传给 `interrupt()` | 外部调用 |
| `Command(goto=节点名, update=字典)` | 节点内直接指定下一步 + 更新 state | 节点内部 |
| `Command(update=字典)` | 只更新 state，不改变走向 | 节点内部 |

## resume — 恢复中断

## goto + update — 节点内控制走向
简化只更新state的节点

通常节点**只返回 state 更新**，靠边决定下一步。用 `Command(goto=...)` 可以在节点内直接指定下一步：

```python
def node_call_llm(state):
    result = model.invoke(state["messages"])

    if result.tool_calls:
        # 节点自己决定下一步去哪
        return Command(
            goto="tool_node",              # ← 直接指定去 tool_node
            update={"messages": [result]}   # ← 同时更新 state
        )
    return Command(
        goto=END,                          # ← 直接结束
        update={"messages": [result]}
    )

# 编译时
builder.add_node("llm_call", node_call_llm)
builder.add_edge(START, "llm_call")
# 不需要 add_conditional_edges，节点自己用 Command 控制走向
```

## goto 的作用

`Command(goto=节点名)` 相当于**路由函数 + 条件边**的合并版，把判断逻辑写在节点里：

```python
# 写法A：条件边（你原来的）
def should_continue(state):
    if last.tool_calls: return "tool_node"
    return END

# 写法B：Command（节点自己决定）
def llm_call(state):
    result = model.invoke(...)
    if result.tool_calls:
        return Command(goto="tool_node", update={"messages": [result]})
    return Command(goto=END, update={"messages": [result]})
```

## Command(goto) 注意事项

```python
# ✅ 用 Command(goto=...) 时，不需要 add_conditional_edges
# ❌ 不能既用 Command(goto) 又用 add_conditional_edges
# ✅ 用 Command(goto) 的节点只需要 add_edge(START, "节点") 即可
```
