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