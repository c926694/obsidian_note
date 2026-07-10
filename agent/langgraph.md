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