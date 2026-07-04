
# 模型
## 创建
通过init_chat_model函数统一创建模型对象
四个参数如下代码块
```python
# 用dotenv读取环境变量  
from dotenv import load_dotenv  
import os  
  
from langchain.chat_models import init_chat_model  
  
load_dotenv(override=True)  
api_key = os.getenv("API_KEY")  
base_url = os.getenv("BASE_URL")  
model_name=os.getenv("MODEL_NAME")  
  
model=init_chat_model(  
    model=model_name,  
    model_provider="openai",  
    api_key=api_key,  
    base_url=base_url  
)  
  
print(model.invoke("你好"))
```
**参数**
聊天模型接受可用于配置其行为的一组参数。支持的参数集因模型和提供商而异，但标准参数包括：

| 参数            | 类型     | 必填  | 说明                                               |
| ------------- | ------ | --- | ------------------------------------------------ |
| `model`       | string | 是   | 您想使用的特定模型的名称或标识符。                                |
| `api_key`     | string | 否   | 用于向模型提供商进行身份验证的密钥。通常在注册访问模型时颁发。通常通过设置**环境变量**访问。 |
| `temperature` | number | 否   | 控制模型输出的随机性。值越高，响应越具创造性；值越低，响应越确定性。               |
| `timeout`     | number | 否   | 在取消请求之前等待模型响应的最大时间（秒）。                           |
| `max_tokens`  | number | 否   | 限制响应中的**令牌**总数，有效控制输出长度。                         |
| `max_retries` | number | 否   | 如果因网络超时或速率限制等问题而失败，系统将重新发送请求的最大尝试次数。             |
|               |        |     |                                                  |
## 调用
### 非流式
这里res.content可获取相关内容
```python
from langchain.messages import HumanMessage, AIMessage, SystemMessage

conversation = [
    {"role": "system", "content": "你是一个将英语翻译成法语的有用助手。"},
    {"role": "user", "content": "翻译：我喜欢编程。"},
    {"role": "assistant", "content": "J'adore la programmation."},
    {"role": "user", "content": "翻译：我喜欢构建应用程序。"}
]

response = model.invoke(conversation)
print(response.content)  # AIMessage("J'adore créer des applications.")
```
或者使用res.pretty_print或者使用rich库的print
```python
res.pretty_print()  
rprint(res)
```
### 流式
调用 [`stream()`](https://reference.langchain.com/python/langchain_core/language_models/#langchain_core.language_models.chat_models.BaseChatModel.stream) 返回一个**迭代器**，它在生成时逐块产生输出。可以使用循环实时处理每个块：
chunk.text和chunk.content的区别是前者比后者多了多模态信息,更稳定
```py
for chunk in model.stream([  
        HumanMessage(content="你是谁？")  
    ]  
):  
    print(chunk.text, end="", flush=True)
```
拼凑完整消息
```py
full = None  # None | AIMessageChunk  
for chunk in model.stream("天空是什么颜色？"):  
    full = chunk if full is None else full + chunk  
  
# 天空  
# 天空是  
# 天空通常  
# 天空通常是蓝色  
# ...  
  
print(full.text)
```
### batch
batch批量调用大模型返回一个res列表
比单纯invoke速度快
```py
responses = model.batch([
    "为什么鹦鹉有五颜六色的羽毛？",
    "飞机是如何飞行的？",
    "什么是量子计算？"
])
for response in responses:
    print(response)
```
控制最大并行数
```py
model.batch(
    list_of_inputs,
    config={
        'max_concurrency': 5,  # 限制为 5 个并行调用
    }
)
```
# 消息
消息是 LangChain 中模型上下文的基本单位。它们代表模型的输入和输出，携带内容和元数据，用于在与 LLM 交互时表示对话状态。

消息是包含以下内容的对象：

- **角色** - 标识消息类型（例如 `system`、`user`）
- **内容** - 表示消息的实际内容（例如文本、图像、音频、文档等）
- **元数据** - 可选字段，例如响应信息、消息 ID 和令牌使用情况

LangChain 提供了一种标准消息类型，可在所有模型提供商之间工作，确保无论调用哪个模型都能保持一致的行为。
## 基本用法
{"role":"system","content":"你是一个小助手"}
本质是一个字典,kv结构,langchain里面用面向对象的方式
内置了消息对象
```py
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage, SystemMessage

model = init_chat_model("openai:gpt-5-nano")

system_msg = SystemMessage("You are a helpful assistant.")
human_msg = HumanMessage("Hello, how are you?")

# 与聊天模型一起使用
messages = [system_msg, human_msg]
response = model.invoke(messages)  # 返回 AIMessage
```
## 文本提示

文本提示是字符串 - 适用于不需要保留对话历史的简单生成任务。

```python
response = model.invoke("Write a haiku about spring")
```
## 消息元数据
name字段的用处看具体的模型提供商
```py
human_msg = HumanMessage(
    content="Hello!",
    name="alice",  # 可选：标识不同用户
    id="msg_123",  # 可选：用于追踪的唯一标识符
)
```
## AI 消息

[`AIMessage`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessage) 表示模型调用的**输出**。它们可以包含多模态数据、工具调用和提供商特定的元数据

```python
response = model.invoke("Explain AI")
print(type(response))  # <class 'langchain_core.messages.AIMessage'>
```

提供商对不同类型的消息的权重/上下文处理不同，这意味着有时手动创建新的 [`AIMessage`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessage) 对象并将其插入消息历史中就像来自模型一样很有帮助。

```python
from langchain.messages import AIMessage, SystemMessage, HumanMessage

# 手动创建 AI 消息（例如，用于对话历史）
ai_msg = AIMessage("I'd be happy to help you with that question!")

# 添加到对话历史
messages = [
    SystemMessage("You are a helpful assistant"),
    HumanMessage("Can you help me?"),
    ai_msg,  # 插入就像来自模型一样
    HumanMessage("Great! What's 2+2?")
]

response = model.invoke(messages)
```
属性
- **text** (`string`)  
    消息的文本内容。
    
- **content** (`string | dict[]`)  
    消息的原始内容。
    
- **content_blocks** (`ContentBlock[]`)  
    消息的标准化[内容块](https://langchain-doc.cn/v1/python/langchain/messages.html#%E6%B6%88%E6%81%AF%E5%86%85%E5%AE%B9)。
    
- **tool_calls** (`dict[] | None`)  
    模型进行的工具调用。如果没有调用工具，则为空。
    
- **id** (`string`)  
    消息的唯一标识符（由 LangChain 自动生成或在提供商响应中返回）
    
- **usage_metadata** (`dict | None`)  
    消息的使用元数据，可包含可用时的令牌计数。
    
- **response_metadata** (`ResponseMetadata | None`)  
    消息的响应元数据。
    

#### [工具调用](https://langchain-doc.cn/v1/python/langchain/messages.html#%E5%B7%A5%E5%85%B7%E8%B0%83%E7%94%A8)

当模型进行[工具调用](https://langchain-doc.cn/v1/python/langchain/models#tool-calling)时，它们包含在 [`AIMessage`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessage) 中：

```python
from langchain.chat_models import init_chat_model

model = init_chat_model("openai:gpt-5-nano")

def get_weather(location: str) -> str:
    """Get the weather at a location."""
    ...

model_with_tools = model.bind_tools([get_weather])
response = model_with_tools.invoke("What's the weather in Paris?")

for tool_call in response.tool_calls:
    print(f"Tool: {tool_call['name']}")
    print(f"Args: {tool_call['args']}")
    print(f"ID: {tool_call['id']}")
```

其他结构化数据（如推理或引用）也可以出现在消息[内容](https://langchain-doc.cn/v1/python/langchain/messages#%E6%B6%88%E6%81%AF%E5%86%85%E5%AE%B9)中。

#### [令牌使用](https://langchain-doc.cn/v1/python/langchain/messages.html#%E4%BB%A4%E7%89%8C%E4%BD%BF%E7%94%A8)

[`AIMessage`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessage) 可以在其 [`usage_metadata`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessage.usage_metadata) 字段中保存令牌计数和其他使用元数据：

```python
from langchain.chat_models import init_chat_model

model = init_chat_model("openai:gpt-5-nano")

response = model.invoke("Hello!")
response.usage_metadata
```

```
{'input_tokens': 8,
 'output_tokens': 304,
 'total_tokens': 312,
 'input_token_details': {'audio': 0, 'cache_read': 0},
 'output_token_details': {'audio': 0, 'reasoning': 256}}
```

有关详细信息，请参阅 [`UsageMetadata`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessage.usage_metadata)。

#### [流式传输和块](https://langchain-doc.cn/v1/python/langchain/messages.html#%E6%B5%81%E5%BC%8F%E4%BC%A0%E8%BE%93%E5%92%8C%E5%9D%97)

在流式传输期间，您将收到可以组合成完整消息对象的 [`AIMessageChunk`](https://reference.langchain.com/python/langchain/messages/#langchain.messages.AIMessageChunk) 对象：

```python
chunks = []
full_message = None
for chunk in model.stream("Hi"):
    chunks.append(chunk)
    print(chunk.text)
    full_message = chunk if full_message is None else full_message + chunk
```

> **了解更多：**
> 
> - [从聊天模型流式传输令牌](https://langchain-doc.cn/v1/python/langchain/models#stream)

## 历史
维护一个消息列表,当超过消息对的时候截断
```py
  
  
from main import model  
  
from langchain.messages import HumanMessage,AIMessage,SystemMessage  
  
  
def keep_history(messages: list[HumanMessage | AIMessage | SystemMessage],max_paris:int=2)->list[HumanMessage | AIMessage | SystemMessage]:  
    """Keep the last max_paris messages."""  
    system_message=[m for m in messages if isinstance(m,SystemMessage)]  
    conversation_messages=[m for m in messages if not isinstance(m,SystemMessage)]  
    recent_messages=system_message+conversation_messages[len(conversation_messages)-2*max_paris:]  
    return recent_messages  
history=keep_history(  
        [  
            SystemMessage(content="你是一个助手，请用一句话解释一个概念。"),  
            HumanMessage(content="用一句话解释什么是量子计算？"),  
            AIMessage(content="量子计算是一种新的计算方式，它利用量子bits（量子比特）来实现计算。"),  
            HumanMessage(content="用一句话解释什么是深度学习？"),  
            AIMessage(content="深度学习是一种机器学习方法，它通过多层神经网络来实现复杂问题的预测。"),  
            HumanMessage(content="用一句话解释什么是区块链？"),  
        ]  
    )  
res=model.invoke(history)  
history.append(AIMessage(content=res.content))  
history=keep_history( history)  
for msg in history:  
    print(msg.content)
```

## 多模态
content作为字符串是描述文本内容
作为字典列表是描述多模态消息
**官方sdk**

```py
with open("./4B39D25438EBB775AF4DB056269669DA.jpg", "rb") as f:  
    img = base64.b64encode(f.read()).decode()  
  
content=[  
    {"type": "text", "text": "这张图片讲了啥"},  
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,"+img}}  
]  
res=model.invoke([HumanMessage(content=content)])
```
content_blocks由langchain提供，  规范化管理多模态消息  
[多模态消息格式](https://langchain-doc.cn/v1/python/langchain/messages.html#%E5%A4%9A%E6%A8%A1%E6%80%81)

```py
content=[  
        {"type": "text", "text": "描述一下这张图片."},  
        {  
            "type": "image",  
            "base64": img,  
            "mime_type": "image/jpeg",  
        },  
    ]  
res=model.invoke([HumanMessage(content_blocks=content)])
```
# 提示词模板
实现拼提示词规范化
## 传入变量
{argv}参数值和invoke中的key:value关联
[]可以用字符串、元组、字典、消息对象、BaseMessagePromptTemplate
消息对象传入来参数**invoke**是无法注入{argv}的，因此一般用**元组
```py
from langchain_core.prompts import ChatPromptTemplate

# 定义一个聊天模板
prompt = ChatPromptTemplate([
    ("system", "你是一个{language}专家"),
    ("human", "请解释一下{concept}"),
])

# 填充变量，生成消息
messages = prompt.invoke({
    "language": "Python",
    "concept": "异步编程",
})

print(messages)

```
## partial
用于先固定一部分参数,这里partial后的参数是一个新对象
需要对新对象调用invoke来填充其它变量

```py
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate([
    ("system", "你是一个{role}专家，擅长{topic}"),
    ("human", "{input}"),
])

# 方式1：用 partial() 预填充
partial_prompt = prompt.partial(role="Python", topic="异步编程")

# 现在只需要传 input 就行了
result = partial_prompt.invoke({"input": "协程是啥"})
print(result.to_messages())
# System: 你是一个Python专家，擅长异步编程
# Human: 协程是啥

```
## 消息占位符
对于历史消息的拼凑用MessagesPlaceholder(variable_name="history")
然后invoke传入消息列表
```py
from main import model  
  
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder  
from langchain_core.messages import HumanMessage, AIMessage  
  
prompt = ChatPromptTemplate([  
    ("system", "你是一个助手"),  
    MessagesPlaceholder(variable_name="history"),  # 历史消息列表  
    ("human", "{input}"),  
])  
  
# 构造消息列表  
history = [  
    HumanMessage(content="你好"),  
    AIMessage(content="你好！有什么可以帮你？"),  
    HumanMessage(content="Python协程怎么做"),  
    AIMessage(content="用 async/await..."),  
]  
  
result = prompt.invoke({  
    "history": history,    # 👈 MessagesPlaceholder 对应的 key    "input": "再讲详细点",  
})  
  
for msg in result.to_messages():  
    print(f"{msg.type}: {msg.content}")  
  
for chunk in model.stream( result):  
    print(chunk.text, end="", flush=True)  
  
# system: 你是一个助手  
# human: 你好  
# ai: 你好！有什么可以帮你？  
# human: Python协程怎么做  
# ai: 用 async/await...# human: 再讲详细点
```
# 工具
## 调用
### **直接调用**
@tool绑定函数赋予Invoke
```py
from langchain_core.tools import tool  
@tool  
def get_weather(city: str) -> str:  
    """  
    获取指定城市的天气信息  
    参数:  
        city: 城市名称，如"北京"、"上海"  
    返回:  
        天气信息字符串  
    """    # 你的实现  
    return city + "晴天，温度 15°C"# 使用 .invoke() 方法  
result = get_weather.invoke({"city": "北京"})  
print(result)
```
### **绑定大模型调用**
invoke返回一个AIMessage对象，里面tool_calls表示大模型这次回答想调用的工具
但是llm没有调用工具的能力
```py
model_with_tools = model.bind_tools([get_weather])  
result = model_with_tools.invoke("北京天气")  
if result.tool_calls:  
    print(result.tool_calls)  
else :  
    print(result.content)
```
### **手动模拟agent调用工具**
1. llm生成AIMessage
2. 判断AIMessage的tool_calls有无调用的工具
3. 有工具则寻找我们写好的get_weather工具并调用
4. tool.invoke生成ToolMessage
5. 将ToolMessage添加到messages中
6. llm基于ToolMessage做出判断
```py
from langchain.messages import HumanMessage, ToolMessage
@tool
def get_weather(city: str):
    """获取天气的工具"""
    return f"{city}天气晴朗~"
# 将模型和工具绑定
model_with_tools = model.bind_tools([get_weather])
messages = [
    HumanMessage("今天北京天气如何")
]
# 模型生成调用工具请求
response = model_with_tools.invoke(messages)
# 添加AIMessage
messages.append(response)
tool_calls = response.tool_calls
for tool_call in tool_calls:
    if tool_call["name"] == "get_weather":
        # 返回的是ToolMessage类型消息
        tool_response = get_weather.invoke(tool_call)
        print(type(tool_response))
        messages.append(tool_response)
print("=====================> messages <=====================")
for msg in messages:
    msg.pretty_print()
print("=====================> messages <=====================")
final_response = model_with_tools.invoke(messages)
print(f"final_response: \n{final_response}")
```
## @tool定义工具
可以对工具进行description、Args、Returns的描述

### description参数
@tool 的参数description 可以更改工具描述，优先级高于docstring 的函数说明
```py
from langchain_core.utils.function_calling import convert_to_openai_tool
from langchain.tools import tool
from rich import print as rprint
@tool(description="根据城市名称查询当日天气的工具")
def get_weather(city: str):
    """
    天气查询工具
    """
    return f"{city}天气晴朗"
rprint(convert_to_openai_tool(get_weather))
```
### docstring
当我们没有向@tool 传递description 参数时，默认情况下，tool 会将docstring 整体视为description
通过将parse_docstring 设置为True，docstring会被解析，填充到相应的字段描述中
```py
from langchain_core.utils.function_calling import convert_to_openai_tool
from rich import print as rprint
@tool
def get_weather(city: str, units: str = "celsius", include_forecast: bool =
False
    """
    获取当日天气，可选择是否同时查询未来五日天气预报
    Args:
        city: 城市
        units: 气温单位，可选：celsius-摄氏度，fahrenheit-华氏度
        include_forecast: 是否包含未来五日的天气预报
    """
    temp = 22 if units == "celsius" else 72
    result = f'{city}当天气温: {temp} {"摄氏度" if units == "celsius" else "华
氏度"
    if include_forecast:
        result += "\n未来五天都是晴天"
    return result
rprint(convert_to_openai_tool(get_weather))
```
**docstring规范**
```py
def connect_to_next_port(self, minimum: int) -> int:
    """Connects to the next available port.

    Args:
      minimum: A port value greater or equal to 1024.

    Returns:
      The new minimum port.

    Raises:
      ConnectionError: If no available port is found.
    """
```
### 自定义args_schema
通过pydantic定义工具的输入类，优先级高于函数签名的描述
通过类描述传给llm更清晰
```py
from pydantic import BaseModel, Field
from langchain.tools import tool
from langchain_core.utils.function_calling import convert_to_openai_tool
class WeatherInput(BaseModel):
    city: str = Field(
        default= "北京",
        description="城市"
    )
    unit: Literal["celsius", "fahrenheit"] = Field(
        default="celsius",
        description="气温单位"
    )
    include_forecast: bool = Field(
        default=False,
        description="是否包含未来五日天气预报"
    )
@tool(args_schema=WeatherInput)
def get_weather(city: str, unit: str = "celsius", include_forecast: bool =
False
    """获取当日天气，可选未来五日天气预报"""
    temp = 22 if unit == "celsius" else 72
    result = f'{city}当天气温: {temp} {"摄氏度" if unit == "celsius" else "华氏
度"
    if include_forecast:
        result += "\n未来五天都是晴天"
    return result
convert_to_openai_tool(get_weather)
```
# 结构化输出
要求**模型**最终返回一个**符合预定义结构的数据对象**，例如固定字段的**JSON**、**Pydantic 模型**、 **TypedDict**，而不再是无格式的自然语言文本。
## pydantic
通过在运行时强制执行类型提示，确保数据的正确性和一致性，是生产场景首选
给llm规定一个输出类型,一定要有描述，否则会报错
with_structured_output(Person)返回的是一个Runnable对象，invoke返回Person实例
![[Pasted image 20260702135527.png]]
```py
class Person(BaseModel):  
    """人物信息"""  
    name: str = Field(description="姓名")  
    age: int = Field(description="年龄")  
    occupation: str = Field(description="职业")  
  
  
structured_llm = model.with_structured_output(Person)  
result = structured_llm.invoke("请以json格式提取下面的信息:张三是一名 30 岁的软件工程师")  
print(result)  
print(type(result))  
print(result.name)  
print(result.age)  
print(result.occupation)
```
### 可选字段
Optional指定字段并表明是可选的
invoke后未提到的字段值是None
没用Optional的默认是字段零值
```py
from typing import Optional
from pydantic import BaseModel, Field
class Person(BaseModel):
    """人物信息"""
    name: str = Field(description="姓名")
    age: Optional[int] = Field(description="年龄")
    occupation: str = Field(description="职业")
structured_llm = model_with_closeai.with_structured_output(Person)
structured_llm.invoke("张三是一名医生")
# Person(name='张三', age=None, occupation='医生')
```
### 默认值
Filed指定默认值，不过有的模型厂商无效
```py
from typing import Optional
from pydantic import BaseModel, Field
class Product(BaseModel):
    """产品信息"""
    name: str = Field(description="产品名称")
    price: float = Field(description="价格")
    description: Optional[str] = Field(description="产品描述")
    stock: int = Field(default=100, description="库存")
# 测试
structured_llm = model_with_openrouter.with_structured_output(Product)
print("\n场景1：完整信息")
result1 = structured_llm.invoke("iPhone 15 售价 5999 元，最新款智能手机，库存 50
台"
print(result1)
print("\n场景2：缺少描述和库存")
result2 = structured_llm.invoke("MacBook Pro 售价 12999 元")
print(result2)
场景1：完整信息
name='iPhone 15' price=5999.0 description='最新款智能手机' stock=50
场景2：缺少描述和库存
name='MacBook Pro' price=12999.0 description=None stock=100
```
### 枚举
```py
from enum import Enum
class Priority(str, Enum):
    LOW = "低"
    MEDIUM = "中"
    HIGH = "高"
class Task(BaseModel):
    title: str
    priority: Priority  # 只能是 LOW/MEDIUM/HIGH
```
也可用Literal规定字段值
```py
urgency: Literal["低","中","高"] = Field(description="紧急程度")
```
### 列表提取
输出结构是个列表，于是传PersonList
```py
from typing import List
class Person(BaseModel):
    """人物信息"""
    name: str
    age: int
class PersonList(BaseModel):
    """人物列表信息"""
    people: List[Person]  # 多个 Person 对象
structured_llm = model.with_structured_output(PersonList)
result = structured_llm.invoke("张三 30岁，李四 25岁")
print(result)
people=[Person(name='张三', age=30), Person(name='李四', age=25)]
```
# agent
在计算机科学里，agent（智能体）指一个能**感知环境**、**自主决策**、**执行动作**的实体。核心循环是：
**感知 → 思考/决策 → 执行 → 观察结果 → 循环**


![[Pasted image 20260702142055.png]]
## 创建
```py
from langchain.chat_models import init_chat_model
from langchain.agents import create_agent
# 1. 初始化模型
model = init_chat_model("gpt-4o-mini", model_provider="openai")
# 2. 创建 agent（一步完成）
agent = create_agent(
    model=model,
    tools=[tool1, tool2],
    system_prompt="Agent 的行为指令"  # 可选
)
# 3. 调用
result = agent.invoke({
    "messages": [{"role": "user", "content": "问题"}]
})
```
**多种参数**
[参数](https://reference.langchain.com/python/langchain/agents/factory/create_agent)
```py
from langchain.agents import create_agent
agent = create_agent(
    model: str | BaseChatModel,            # 必需：聊天模型
    tools: List[BaseTool],                 # 必需：工具列表
    *,
    system_prompt: str = "",               # 系统提示词
    middleware: Seguence[AgentMiddleware[StateT_co, ContextT]] = () # 中间件
    interrupt_before: List[str] = None,    # 在某些工具前暂停（人机协作）
    interrupt_after: List[str] = None,     # 在某些工具后暂停
    debug: bool = False                    # 调试模式
    name: str 丨 None = None,              # 设置模型名称
)
```
## 调用
invoke是同步调用方法，它会阻塞程序执行直到返回最终结果
输入：传入的参数为字典类型，字典内通过messages字段传递消息列表。即：“ {"messages": [{"role": "...", "content": "..."}]} ”

输出：通过invoke调用Agent，底层可能会经历多轮交互，返回的是**完整的消息列表**，**被封装在字典中**，是messages字段的值。
```py
response = agent.invoke({"messages": [...]})
# response 是字典类型
{
    "messages": [
        HumanMessage(...),       # 用户问题
        AIMessage(...),          # AI 工具调用
        ToolMessage(...),        # 工具返回结果
        AIMessage(...)           # 最终回答 ← 通常取这个
    ]
}
# 获取最终回答
final_answer = response['messages'][-1].content
```
### 字段扩充
将自定义字段告诉agent,然后扩充state的字段
```py
from langgraph.graph import State
from typing import TypedDict, Annotated

class MyState(TypedDict):
    messages: list[BaseMessage]
    user_name: str      # ← 自定义字段
    todo_list: list     # ← 自定义字段

# 创建 agent 时传入自定义 state
agent = create_agent(
    model=model,
    state_schema=MyState,  # ← 使用你定义的 state
)

# 现在可以传自定义字段了
agent.invoke({
    "messages": [HumanMessage("帮我加一个买牛奶的任务")],
    "user_name": "张三",
    "todo_list": [],
})

```
## 绑定工具
![[Pasted image 20260702151352.png]]
### 内部函数tool
```py
@tool(parse_docstring=True)  
def get_weather(city: str) -> str:  
    """  
    天气查询工具  
  
    Args:        city: 城市名称  
    """    return f"{city}的天气为晴朗，25°C。"  
  
  
agent = create_agent(  
    model=model,  
    tools=[get_weather]  
)  
resp = agent.invoke({  
    "messages": [  
        {"role": "system", "content": "你是一个天气查询助手，只回答天气相关的问题，其他问题请直接回答：我不清楚这问题答案。"},  
        {"role": "user", "content": "北京的天气怎么样？"}  
]  
})  
rprint(resp["messages"][-1].content)
```
### 外部api
langchain内置了许多外部api工具
```py
web_search = TavilySearch(  
    tavily_api_key=os.getenv("TAVILY_API_KEY"),  
    max_results=2  
)
agent = create_agent(  
    model=model,  
    tools=[web_search]  
)  
resp = agent.invoke({  
    "messages": [  
        {"role": "system", "content": "你是一个天气查询助手，只回答天气相关的问题，其他问题请直接回答：我不清楚这问题答案。"},  
        {"role": "user", "content": "湖南益阳的天气怎么样？"}  
]  
})  
rprint(resp["messages"][-1].content)
```
### 重试机制
```py
from langchain.agents import create_agent
from langchain.tools import tool
from langchain.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv
from rich import print as rprint
load_dotenv(override=True)
flag = 0
@tool
def get_weather(city: str):
    """
    天气查询工具
    Args:
        city: 城市名称
    """
    global flag
    flag += 1
    if flag < 3:
        # raise Exception("暂时无法访问")
        return "TEMP_UNAVAILABLE: 天气服务暂时不可用，请稍后重试"
    return f"{city}今天天气挺好"
messages = [
    SystemMessage("""
    你是一个天气助手。
    当工具返回以 'TEMP_UNAVAILABLE:' 开头的结果时，
    说明是临时故障，不要立即放弃；
    你应再次调用同一个工具，最多重试 3 次。
    如果 3 次后仍失败，再向用户说明服务暂时不可用。
    """
    HumanMessage("你好，杭州今天的天气如何？")
]
agent = create_agent(model, tools=[get_weather])
response = agent.invoke({"messages": messages})
# rprint(response)
for msg in response["messages"]:
    msg.pretty_print()
```
## agent名字
创建agent的时候指定名字
Multi-Agent 场景使用name
```py
agent = create_agent(

model=model,

name = "chat_assistant"

)
```
## 结构化输出
让agent的输出是结构化的
### ToolStrategy
ToolStrategy通过工具调用（Tool Calling/Function Calling）实现结构化输出
```py
from pydantic import BaseModel
from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
# 2.Pydantic结构化方式定义
class ContactInfo(BaseModel):
    name: str = Field(description="姓名")
    email: str = Field(description="邮箱")
    phone: str = Field(description="电话")
# 3.工具的定义（根据需要定义）
@tool
def search_tool(query: str) -> str:
    """这是一个搜索引擎。当大模型发现给定的上下文里缺少必要的联系人信息，
    需要去互联网上查询时，才会调用这个工具。
    """
    return f"搜索结果: 未找到关于 '{query}' 的更多额外信息。"
# 3.agent初始化
agent = create_agent(
    model=model,
    tools=[search_tool],
    response_format=ToolStrategy(ContactInfo)
)
result = agent.invoke({
    "messages": [{"role": "user", "content": "联系人信息: John Doe,
john@atguigu.com, (010) 56253825"
})
# print(result)
print(result["structured_response"])
name='John Doe' email='john@atguigu.com' phone='(010) 56253825'
```
## 流式输出
### values
每个步骤执行后，都会输出**完整的状态信息**，适用于每一步都要获取完整状态、状态持久化

```py
# 流式：stream_mode="values" 返回完整的消息历史快照  
for chunk in agent.stream(  
    {"messages": [{"role": "user", "content": "查询客户ID为 CUST123456 的个人信息、历史订单和可用优惠"}]},  
    stream_mode="values",  
):  
    last_msg = chunk["messages"][-1]  
    if isinstance(last_msg, AIMessage) and last_msg.content:  
        print(last_msg.content)
```

![[Pasted image 20260702164124.png]]
### updates
只增量更新状态中发生变化的内容，是默认模式
```py
# 其他工具代码同上，保持不变
# ... ...
for chunk in customer_service_agent.stream(
        {"messages": [{"role": "user","content": "查询客户ID为 CUST123456 的完整
信息和可用优惠"
        stream_mode="updates"
):
    rprint(chunk)
    print("-" * 50)
```
### messages
该模式中会输出流式返回的Token以及相关的元数据（如：来自哪个节点），
可以用在实现类似 ChatGPT 的打字机效果场景
```py
# 其他工具代码同上，保持不变
# ... ...
for chunk in customer_service_agent.stream(
        {"messages": [{"role": "user","content": "查询客户ID为 CUST123456 的完整
信息和可用优惠"
        stream_mode="messages"
):
    print(chunk)
    print("-" * 50)
```
# 中间件
Agent 执行过程中的钩子函数
钩子是框架或系统在某些关键执行点暴露的扩展接口。
开发者可以“挂上”自己的逻辑，在那些点上插入、修改或替换行为，而无需改变主流程代码
# 记忆
## 短期记忆
State（会话内部状态） + Checkpointer（持久化机制） + Thread ID（会话作用域）
State ：默认存储历史消息列表messages ，通过State 管理历史消息Checkpointer ：负责将State 作为检查点持久化保存，检查点是某个时刻的State 快照Thread ID ：用于唯一标识State ，LangChain运行时会按照 thread_id 读写State快照
langgraph包基于state管理记忆
每次调用传入config,config中配置thread_id
thread_id隔离不同的会话空间
### 基于内存
✅ 同一进程内有效（不支持跨进程共享）

❌ 程序重启后丢失（或进程重启后丢失）

❌ 不同进程无法共享
```py
from langgraph.checkpoint.memory import InMemorySaver
checkpointer = InMemorySaver()
# 1. 创建 Agent 时添加 checkpointer
agent = create_agent(
    model=model,
    checkpointer=checkpointer  # 添加内存管理
)
# 2. 调用时指定 thread_id
config = {
    "configurable": {
        "thread_id": "1"
    }
}
print("\n第一轮对话：")
response1 = agent.invoke({
    "messages": [HumanMessage("我叫张三")]},
    config=config  # 传入 config
)
print(f"Agent: {response1['messages'][-1].content}")
print("\n第二轮对话：")
response2 = agent.invoke({
    "messages": [HumanMessage("我叫什么？")]},
    config=config  # 使用相同的 thread_id
)
print(f"Agent: {response2['messages'][-1].content}")
第一轮对话：
Agent: 你好，张三！很高兴认识你。有什么我可以帮你的吗？
第二轮对话：
Agent: 你叫张三。
```
### 基于pg
```py
from langgraph.checkpoint.postgres import PostgresSaver  
DB_URL ="postgresql://cp:root@127.0.0.1:5431/langchain_db?sslmode=disable"  
with PostgresSaver.from_conn_string(DB_URL) as checkpointer:  
    # 初始化PostgreSQL数据库  
    checkpointer.setup()  
    agent = create_agent(  
        model=model,  
        checkpointer=checkpointer  
    )  
    config = {"configurable": {"thread_id": "1"}}  
    response1 = agent.invoke(  
        {"messages": [HumanMessage("你好，我是老王")]},  
        config=config  
    )  
    print("=" * 30, "-> 第一次调用 <-", "=" * 30)  
    for msg in response1["messages"]:  
        msg.pretty_print()  
    response2 = agent.invoke(  
        {"messages": [HumanMessage("你好，我是谁？")]},  
        config=config  
    )  
    print("=" * 30, "-> 第二次调用 <-", "=" * 30)  
    for msg in response2["messages"]:  
        msg.pretty_print()
```
### 记忆管理
RemoveMessage指定msg.id
return提交state的修改方案
#### 消息裁剪
```py
@before_model  
def trim_messages(state: AgentState, runtime: Runtime) -> dict[str, Any] | None:  
    messages = state["messages"]  
    if len(messages) <= 3:  
        return None  
    first_msg = messages[0]  
    recent_messages = messages[-3:] if len(messages) % 2 == 0 else messages[-4:]  
    new_messages = [first_msg] + recent_messages  
    return {  
        "messages": [  
            RemoveMessage(id=REMOVE_ALL_MESSAGES),  
            *new_messages  
        ]  
    }  
agent = create_agent(  
    model=model,  
    middleware=[trim_messages],  
    checkpointer=InMemorySaver(),  
)  
config: RunnableConfig = {"configurable": {"thread_id": "1"}}  
agent.invoke({"messages": [HumanMessage("你好，我是老王")]}, config)  
agent.invoke({"messages": [HumanMessage("从现在起，你叫小王")]}, config)  
agent.invoke({"messages": [HumanMessage("今天天气不错")]}, config)  
final_response = agent.invoke({"messages": [HumanMessage("告诉我，你是谁？我是                                      谁？"  
)]}, config)  
for msg in final_response["messages"]:  
    msg.pretty_print()
```
#### 消息删除
```py
@after_model  
def delete_old_messages(state: AgentState, runtime: Runtime) -> dict | None:  
    messages = state["messages"]  
    # 保持最近的 5 条消息  
    if len(messages) > 5:  
        # 框架中通常使用 RemoveMessage 来标记删除，并返回更新状态。  
        to_delete = len(messages) - 5  
        return {"messages": [RemoveMessage(id=m.id) for m in  
messages[:to_delete]]}  
    return None
```
## 长期记忆
长期记忆的存储是 store -> namespace -> key -> value 的四层架构。
namespace用于区分用户组
### api
#### put
LangGraph底层将数据封装为 Item 对象

```py
def put(
    self,
    namespace: tuple[str, ...],
    key: str,
    value: dict[str, Any],
    index: Literal[False] | list[str] | None = None,
    *,
    ttl: float | None | NotProvided = NOT_PROVIDED,

```
```py
store.put(
    ("users", "alice", "memories"), # namespace
    "pref_food",                    # key
    {"category": "food", "text": "Alice likes sushi"} # value
)
```
#### get
Item对象新增了created_at 和updated_at 字段，分别为数据新增和更改时间
```py
item = my_store.get(("users", "alice", "memories"), "pref_food")
if item is not None:
    print(item.value)
    # {'category': 'food', 'text': 'Alice likes sushi'}
```
#### pgsql
```py
from langgraph.store.postgres import PostgresStore  
namespace = ("users", )  
user_id = "user-11"  
username = "小蓝"  
DB_URL ="postgresql://cp:root@127.0.0.1:5431/langchain_db?sslmode=disable"  
with PostgresStore.from_conn_string(DB_URL) as store:  
    store.setup()  
    store.put(namespace, user_id, {"name": username})  
    print(store.get(namespace, user_id))
```
#### search
```py
def search(
    self,
    namespace_prefix: tuple[str, ...],
    /,
    *,
    query: str | None = None,
    filter: dict[str, Any] | None = None,
    limit: int = 10,
    offset: int = 0,
    refresh_ttl: bool | None = None,
```
用于模糊查询
```py
print("=" * 30, '-> (users, ), filter=sports <-", "=" * 30)')
for item in store.search(("users", ), filter={"sports": "跑步"}):
    print(item)
```
### 搭配agent
CustomState定义user_id保证和agent对话能够知道用户id
runtime是langgraph的上下文对象,可以获取state、store
```py
store = InMemoryStore()  
class CustomState(AgentState):  
    user_id: NotRequired[str]  
@tool(parse_docstring=True)  
def save_user_info(name: str, runtime: ToolRuntime) -> str:  
    """将用户信息保存在长期记忆中  
        Args:  
        name: 用户名  
  
    Returns:        str: 保存状态  
    """    runtime.store.put(("users",), runtime.state["user_id"], {"name": name})  
    return "saved"  
@tool(parse_docstring=True)  
def get_user_info(runtime: ToolRuntime) -> str:  
    """从长期记忆中读取用户信息  
  
    Returns:        str: 用户信息  
    """    item = runtime.store.get(("users",), runtime.state["user_id"])  
    return str(item.value) if item else "unknown"  
agent = create_agent(  
    model=model,  
    tools=[save_user_info, get_user_info],  
    store=store,  
    system_prompt="用户提及个人信息时及时记录，用户询问个人信息时尝试用工具检索",  
    state_schema=CustomState,  
)  
print("=" * 30, '-> 第一个会话（线程） <-', "=" * 30)  
response1 = agent.invoke({  
    "messages": [HumanMessage("你好，很高兴认识你，我是小花")],  
    "user_id": "user-1"  
})  
for msg in response1["messages"]:  
    msg.pretty_print()  
print("=" * 30, '-> 第二个会话（线程） <-', "=" * 30)  
response2 = agent.invoke({  
    "messages": [HumanMessage("我是谁")],  
    "user_id": "user-1"  
})  
for msg in response2["messages"]:  
    msg.pretty_print()
```
# rag
![[Pasted image 20260703195540.png|901]]
## 文档加载器
```py
from langchain_community.document_loaders import TextLoader

loader=TextLoader(file_path="../asset/load/01-langchain-utf-8.txt", encoding="utf-8")
docs=loader.load()

print(docs)

[Document(metadata={'source': '../asset/load/01-langchain-utf-8.txt'},

page_content='LangChain 是一个用于构建基于大语言模型（LLM）应用的开发框架，旨在帮

助开发者更高效地集成、管理和增强大语言模型的能力，构建端到端的应用程序。它提供了一套模

块化工具和接口，支持从简单的文本生成到复杂的多步骤推理任务'
```
document对象的两个属性
page_content：真正的文档内容，字符串类型。

metadata：文档内容的原数据，字典类型。
## 文档切割器
文档切分器中较常用的是RecursiveCharacterTextSplitter (递归字符文本切分器) ，遇到特定字符时进行分割。默认情况下，它尝试进行切割的字符包括 ["\n\n", "\n", " ", ""]

chunk_size ：每个切块的最大字符数量，默认值为4000。

chunk_overlap ： 相邻两个切块之间的最大重叠字符数量，默认值为200。为了保证段之间语义完

整，可以设置每个块之间有一部分重叠,相当于添加了小部分上下文
add_start : 这一段文本在原始文档里的起点位置
```py
# 1.导入相关依赖

from langchain_text_splitters import RecursiveCharacterTextSplitter

# 2.定义RecursiveCharacterTextSplitter分割器对象

text_splitter = RecursiveCharacterTextSplitter(

    chunk_size=10,

    chunk_overlap=0,

    add_start_index=True,

)

# 3.定义拆分的内容

text="LangChain框架特性\n\n多模型集成(GPT/Claude)\n记忆管理功能\n链式调用设计。文档分析场景示例：需要处理PDF/Word等格式。"

# 4.拆分器分割

paragraphs = text_splitter.split_text(text)

for i,chunk in enumerate(paragraphs):

    print(f"块{i + 1},长度：{len(chunk)}")

    print(chunk)

    print('-' * 50)
```
## 向量化
```py
from langchain_community.embeddings import DashScopeEmbeddings

embedding_model = DashScopeEmbeddings(
    model=embedding_model_name,   # 比如 "text-embedding-v2"
    dashscope_api_key=api_key,
)

```
### 句子
```py
from main import embedding_model

# 待嵌入的文本句子

text = "What was the name mentioned in the conversation?"

# 生成一个嵌入向量

embedded_query = embedding_model.embed_query(text)

# 使用embedded_query[:5]来查看前5个元素的值

print(embedded_query[:5])

print(len(embedded_query))
```
### 文档
```py
# 待嵌入的文本列表
texts = [
    "Hi there!",
    "Oh, hello!",
    "What's your name?",
    "My friends call me World",
    "Hello World!"
]
# 生成嵌入向量
embeded_docs = embedding_model.embed_documents(texts)
for i in range(len(texts)):
    print(f"{texts[i]}:{embeded_docs[i][:3]}",end="\n\n")
```
### 向量数据库
```py
from pymilvus import MilvusClient
# =========================
# 1. 基本配置
# =========================
MILVUS_URI = "http://localhost:19530"  # Milvus 服务的连接地址
DB_NAME = "rag_tutorial"    # 自定义数据库名称
COLLECTION_NAME = "docs"    # 向量集合名称（类似于传统数据库的表）
KNOWLEDGE_FILE = "../knowledge.txt"  # 本地知识库文件路径
# BGE-M3 在 SiliconFlow / Milvus 文档中都是 1024 维
EMBED_MODEL_NAME = "Pro/BAAI/bge-m3"   # 嵌入模型名称
EMBED_DIM = 1024   # BGE-M3 模型输出的向量维度固定为 1024
```