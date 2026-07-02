
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
给llm规定一个输出类型
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