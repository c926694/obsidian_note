# 概念

在计算机科学里，agent（智能体）指一个能**感知环境**、**自主决策**、**执行动作**的实体。核心循环是：

**感知 → 思考/决策 → 执行 → 观察结果 → 循环**

LLM 本身只是一个语言模型——你给它文本，它返回文本，没有工具、没有记忆、不会自己做事。

当把 LLM 塞进一个 agent 框架后，LLM 扮演的是大脑/决策中枢的角色

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=NDBmMDZhODUxYzFlN2ZkN2IzZWRjNDU5ZTEzODE3YmZfdFp6VXo3SmJ2eGNubjVwNzR5SDlsM1NLNUNRSllndVBfVG9rZW46VmxOV2JZcllxbzhRS2R4NDBqamNSdzhvbjlkXzE3ODI4MzUyMzc6MTc4MjgzODgzN19WNA&add_watermark=true&scene_type=CCM)

# 范式

## llm函数封装

模型是大脑,通过api_key、base_url、model_id连接模型client

client调用不同类型的处理函数

```Python
import os
from openai import OpenAI
from dotenv import load_dotenv
from typing import List, Dict

# 加载 .env 文件中的环境变量
load_dotenv()

class HelloAgentsLLM:
    """
    为本书 "Hello Agents" 定制的LLM客户端。
    它用于调用任何兼容OpenAI接口的服务，并默认使用流式响应。
    """
    def __init__(self, model: str = None, apiKey: str = None, baseUrl: str = None, timeout: int = None):
        """
        初始化客户端。优先使用传入参数，如果未提供，则从环境变量加载。
        """
        self.model = model or os.getenv("LLM_MODEL_ID")
        apiKey = apiKey or os.getenv("LLM_API_KEY")
        baseUrl = baseUrl or os.getenv("LLM_BASE_URL")
        timeout = timeout or int(os.getenv("LLM_TIMEOUT", 60))
        
        if not all([self.model, apiKey, baseUrl]):
            raise ValueError("模型ID、API密钥和服务地址必须被提供或在.env文件中定义。")

        self.client = OpenAI(api_key=apiKey, base_url=baseUrl, timeout=timeout)

    def think(self, messages: List[Dict[str, str]], temperature: float = 0) -> str:
        """
        调用大语言模型进行思考，并返回其响应。
        """
        print(f"🧠 正在调用 {self.model} 模型...")
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                stream=True,
            )
            
            # 处理流式响应
            print("✅ 大语言模型响应成功:")
            collected_content = []
            for chunk in response:
                if not chunk.choices:
                    continue
                content = chunk.choices[0].delta.content or ""
                print(content, end="", flush=True)
                collected_content.append(content)
            print()  # 在流式输出结束后换行
            return "".join(collected_content)

        except Exception as e:
            print(f"❌ 调用LLM API时发生错误: {e}")
            return None

# --- 客户端使用示例 ---
if __name__ == '__main__':
    try:
        llmClient = HelloAgentsLLM()
        
        exampleMessages = [
            {"role": "system", "content": "You are a helpful assistant that writes Python code."},
            {"role": "user", "content": "写一个快速排序算法"}
        ]
        
        print("--- 调用LLM ---")
        responseText = llmClient.think(exampleMessages)
        if responseText:
            print("\n\n--- 完整模型响应 ---")
            print(responseText)

    except ValueError as e:
        print(e)
```

## ReAct

将**推理** (Reasoning) 与**行动** (Acting) 显式地结合起来，形成一个“**思考-行动-观察**”的循环。

- Thought (思考)： 这是智能体的“内心独白”。它会分析当前情况、分解任务、制定下一步计划，或者反思上一步的结果。
    
- Action (行动)： 这是智能体决定采取的具体动作，通常是调用一个外部工具，例如 `Search['华为最新款手机']`。
    
- Observation (观察)： 这是执行`Action`后从外部工具返回的结果，例如搜索结果的摘要或API的返回值。
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=MDU1ZWI3MWM1MTUwZjBjN2RmMzdmNWY0MDdlN2U0NjlfM05CTFdqMHZPWFB1M25xMHZaVXVGWFpwaTdhSDQ3T0dfVG9rZW46STNXN2JqYWJVb1hlM3B4VVRNYWNYaU9IbmRmXzE3ODI4MzUyMzc6MTc4MjgzODgzN19WNA&add_watermark=true&scene_type=CCM)

ReAct适用场景

- 需要与API交互的任务：如操作数据库、调用某个服务的API来完成特定功能。
    

### 工具定义

1. 名称 (Name)： 一个简洁、唯一的标识符，供智能体在 `Action` 中调用，例如 `Search`。
    
2. 描述 (Description)： 一段清晰的自然语言描述，说明这个工具的用途。这是整个机制中最关键的部分，因为大语言模型会依赖这段描述来判断何时使用哪个工具。
    
3. 执行逻辑 (Execution Logic)： 真正执行任务的函数或方法。
    

react需要通过api交互,比如搜索功能

于是定义一个工具用于搜索

工具管理通过一个工具执行类来管理一个或多个工具

```Python
import os

from dotenv import load_dotenv
from serpapi import SerpApiClient

load_dotenv()
from typing import Dict, Any

class ToolExecutor:
    """
    一个工具执行器，负责管理和执行工具。
    """

    def __init__(self):
        self.tools: Dict[str, Dict[str, Any]] = {}

    def registerTool(self, name: str, description: str, func: callable):
        """
        向工具箱中注册一个新工具。
        """
        if name in self.tools:
            print(f"警告:工具 '{name}' 已存在，将被覆盖。")
        self.tools[name] = {"description": description, "func": func}
        print(f"工具 '{name}' 已注册。")

    def getTool(self, name: str) -> callable:
        """
        根据名称获取一个工具的执行函数。
        """
        return self.tools.get(name, {}).get("func")

    def getAvailableTools(self) -> str:
        """
        获取所有可用工具的格式化描述字符串。
        """
        return "\n".join(
            [f"- {name}: {info['description']}" for name, info in self.tools.items()]
        )

def search(query: str) -> str:
    """
    一个基于SerpApi的实战网页搜索引擎工具。
    它会智能地解析搜索结果，优先返回直接答案或知识图谱信息。
    """
    print(f"🔍 正在执行 [SerpApi] 网页搜索: {query}")
    try:
        api_key = os.getenv("SERPAPI_API_KEY")
        if not api_key:
            return "错误:SERPAPI_API_KEY 未在 .env 文件中配置。"

        params = {
            "engine": "google",
            "q": query,
            "api_key": api_key,
            "gl": "cn",  # 国家代码
            "hl": "zh-cn",  # 语言代码
        }

        client = SerpApiClient(params)
        results = client.get_dict()

        # 调试: 打印完整返回
        # print(f"🐛 SerpApi 完整返回: {results}")

        # 智能解析:优先寻找最直接的答案
        if "answer_box_list" in results:
            return "\n".join(results["answer_box_list"])
        if "answer_box" in results and "answer" in results["answer_box"]:
            return results["answer_box"]["answer"]
        if "knowledge_graph" in results and "description" in results["knowledge_graph"]:
            return results["knowledge_graph"]["description"]
        if "organic_results" in results and results["organic_results"]:
            # 如果没有直接答案，则返回前三个有机结果的摘要
            snippets = [
                f"[{i+1}] {res.get('title', '')}\n{res.get('snippet', '')}"
                for i, res in enumerate(results["organic_results"][:3])
            ]
            return "\n\n".join(snippets)

        return f"对不起，没有找到关于 '{query}' 的信息。"

    except Exception as e:
        return f"搜索时发生错误: {e}"
```

### 编码实现ReAct

定义一个ReActAgent类,内部嵌入llm_client、tool_executor、max_step、history

进入循环->格式化提示词->调用llm获取thought、action

判断action是否finish

未finish,根据action调用可能存在的tool->获取observation->增加thought、observation到history->循环

- 结果标志需要prompt设定finish关键字
    

```Plain
REACT_PROMPT_TEMPLATE = """
请注意，你是一个有能力调用外部工具的智能助手。

可用工具如下:
{tools}

请严格按照以下格式进行回应:

Thought: 你的思考过程，用于分析问题、拆解任务和规划下一步行动。
Action: 你决定采取的行动，必须是以下格式之一:
- `{{tool_name}}[{{tool_input}}]`:调用一个可用工具。
- `Finish[最终答案]`:当你认为已经获得最终答案时。
- 当你收集到足够的信息，能够回答用户的最终问题时，你必须在Action:字段后使用 Finish[最终答案] 来输出最终答案。

现在，请开始解决以下问题:
Question: {question}
History: {history}
"""
```

```Python
# ReAct 提示词模板
import re

from dotenv import load_dotenv
from HelloAgent import HelloAgentsLLM
from search_tool import ToolExecutor, search
load_dotenv()

class ReActAgent:
    def __init__(self, llm_client: HelloAgentsLLM, tool_executor: ToolExecutor, max_steps: int = 5):
        self.llm_client = llm_client
        self.tool_executor = tool_executor
        self.max_steps = max_steps
        self.history = []

    def run(self, question: str):
        """
        运行ReAct智能体来回答一个问题。
        """
        self.history = [] # 每次运行时重置历史记录
        current_step = 0

        while current_step < self.max_steps:
            current_step += 1
            print(f"--- 第 {current_step} 步 ---")

            # 1. 格式化提示词
            tools_desc = self.tool_executor.getAvailableTools()
            history_str = "\n".join(self.history)
            prompt = REACT_PROMPT_TEMPLATE.format(
                tools=tools_desc,
                question=question,
                history=history_str
            )

            # 2. 调用LLM进行思考
            messages = [{"role": "user", "content": prompt}]
            response_text = self.llm_client.think(messages=messages)
            
            if not response_text:
                print("错误:LLM未能返回有效响应。")
                break

            # ... (后续的解析、执行、整合步骤)
            # (这些方法是 ReActAgent 类的一部分)
            # (这段逻辑在 run 方法的 while 循环内)
            # 3. 解析LLM的输出
            thought, action = self._parse_output(response_text)
            
            if thought:
                print(f"思考: {thought}")

            if not action:
                print("警告:未能解析出有效的Action，流程终止。")
                break

            # 4. 执行Action
            if action.startswith("Finish"):
                # 如果是Finish指令，提取最终答案并结束
                final_answer = re.match(r"Finish\[(.*)\]", action, re.DOTALL).group(1)
                print(f"🎉 最终答案: {final_answer}")
                return final_answer
            
            tool_name, tool_input = self._parse_action(action)
            if not tool_name or not tool_input:
                # ... 处理无效Action格式 ...
                continue

            print(f"🎬 行动: {tool_name}[{tool_input}]")
            
            tool_function = self.tool_executor.getTool(tool_name)
            if not tool_function:
                observation = f"错误:未找到名为 '{tool_name}' 的工具。"
            else:
                observation = tool_function(tool_input) # 调用真实工具
                # (这段逻辑紧随工具调用之后，在 while 循环的末尾)
            print(f"👀 观察: {observation}")
            
            # 将本轮的Action和Observation添加到历史记录中
            self.history.append(f"Action: {action}")
            self.history.append(f"Observation: {observation}")

        # 循环结束
        print("已达到最大步数，流程终止。")
        return None

    def _parse_output(self, text: str):
        """解析LLM的输出，提取Thought和Action。
        """
        # Thought: 匹配到 Action: 或文本末尾
        thought_match = re.search(r"Thought:\s*(.*?)(?=\nAction:|$)", text, re.DOTALL)
        # Action: 匹配到文本末尾
        action_match = re.search(r"Action:\s*(.*?)$", text, re.DOTALL)
        thought = thought_match.group(1).strip() if thought_match else None
        action = action_match.group(1).strip() if action_match else None
        return thought, action

    def _parse_action(self, action_text: str):
        """解析Action字符串，提取工具名称和输入。
        """
        match = re.match(r"(\w+)\[(.*)\]", action_text, re.DOTALL)
        if match:
            return match.group(1), match.group(2)
        return None, None

if __name__ == '__main__':
    llm_client = HelloAgentsLLM()
    tool_executor = ToolExecutor()
    search_description = "一个网页搜索引擎。当你需要回答关于时事、事实以及在你的知识库中找不到的信息时，应使用此工具。"
    tool_executor.registerTool("Search", search_description, search)
    agent = ReActAgent(llm_client, tool_executor)
    result = agent.run("华为最新手机型号及主要卖点")
```

## Plan-and-solve

### 思路

1. 规划阶段 (Planning Phase)： 首先，智能体会接收用户的完整问题。它的第一个任务不是直接去解决问题或调用工具，而是将问题分解，并制定出一个清晰、分步骤的行动计划。这个计划本身就是一次大语言模型的调用产物。
    
2. 执行阶段 (Solving Phase)： 在获得完整的计划后，智能体进入执行阶段。它会严格按照计划中的步骤，逐一执行。每一步的执行都可能是一次独立的 LLM 调用，或者是对上一步结果的加工处理，直到计划中的所有步骤都完成，最终得出答案。
    

- plan根据request生成plan->executor执行plan->每次追加当前计划和执行结果用于下一次循环调用
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=YzZmMTI4NzEyODRmNTBkMmYyNjM3NGM2Mzc5MWFlZmVfbXFTaU81a0JlUXZmNHhDZXRpVVRFbGRaSkMwSDJvZWVfVG9rZW46T3BNQmJoeUZlb1pIRFF4Z01uMWM1QjVPbjB0XzE3ODI4MzUyMzc6MTc4MjgzODgzN19WNA&add_watermark=true&scene_type=CCM)

**应用场景**

- 多步数学应用题：需要先列出计算步骤，再逐一求解。
    
- 需要整合多个信息源的报告撰写：需要先规划好报告结构（引言、数据来源A、数据来源B、总结），再逐一填充内容。
    
- 代码生成任务：需要先构思好函数、类和模块的结构，再逐一实现。
    

### plan类

````Plain
PLANNER_PROMPT_TEMPLATE = """
你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。
你的输出必须是一个Python列表，其中每个元素都是一个描述子任务的字符串。

问题: {question}

请严格按照以下格式输出你的计划,```python与```作为前后缀是必要的:
```python
["步骤1", "步骤2", "步骤3", ...]
```
"""
````

```Python
# 假定 llm_client.py 中的 HelloAgentsLLM 类已经定义好
# from llm_client import HelloAgentsLLM

import ast

class Planner:
    def __init__(self, llm_client):
        self.llm_client = llm_client

    def plan(self, question: str) -> list[str]:
        """
        根据用户问题生成一个行动计划。
        """
        prompt = PLANNER_PROMPT_TEMPLATE.format(question=question)
        
        # 为了生成计划，我们构建一个简单的消息列表
        messages = [{"role": "user", "content": prompt}]
        
        print("--- 正在生成计划 ---")
        # 使用流式输出来获取完整的计划
        response_text = self.llm_client.think(messages=messages) or ""
        
        print(f"✅ 计划已生成:\n{response_text}")
        
        # 解析LLM输出的列表字符串
        try:
            # 找到```python和```之间的内容
            plan_str = response_text.split("```python")[1].split("```")[0].strip()
            # 使用ast.literal_eval来安全地执行字符串，将其转换为Python列表
            plan = ast.literal_eval(plan_str)
            return plan if isinstance(plan, list) else []
        except (ValueError, SyntaxError, IndexError) as e:
            print(f"❌ 解析计划时出错: {e}")
            print(f"原始响应: {response_text}")
            return []
        except Exception as e:
            print(f"❌ 解析计划时发生未知错误: {e}")
            return []
```

### executor类

```Plain
EXECUTOR_PROMPT_TEMPLATE = """
你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
你将收到原始问题、完整的计划、以及到目前为止已经完成的步骤和结果。
请你专注于解决“当前步骤”，并仅输出该步骤的最终答案，不要输出任何额外的解释或对话。

# 原始问题:
{question}

# 完整计划:
{plan}

# 历史步骤与结果:
{history}

# 当前步骤:
{current_step}

请仅输出针对“当前步骤”的回答:
"""
```

```Python
class Executor:
    def __init__(self, llm_client):
        self.llm_client = llm_client

    def execute(self, question: str, plan: list[str]) -> str:
        """
        根据计划，逐步执行并解决问题。
        """
        history = "" # 用于存储历史步骤和结果的字符串
        
        print("\n--- 正在执行计划 ---")
        
        for i, step in enumerate(plan):
            print(f"\n-> 正在执行步骤 {i+1}/{len(plan)}: {step}")
            
            prompt = EXECUTOR_PROMPT_TEMPLATE.format(
                question=question,
                plan=plan,
                history=history if history else "无", # 如果是第一步，则历史为空
                current_step=step
            )
            
            messages = [{"role": "user", "content": prompt}]
            
            response_text = self.llm_client.think(messages=messages) or ""
            
            # 更新历史记录，为下一步做准备
            history += f"步骤 {i+1}: {step}\n结果: {response_text}\n\n"
            
            print(f"✅ 步骤 {i+1} 已完成，结果: {response_text}")

        # 循环结束后，最后一步的响应就是最终答案
        final_answer = response_text
        return final_answer
```

### plan-and-solve类

将plan和executor组合

两个类都内置提示词用于调用llm生成plan和执行plan

```Python
from agent.plan import Planner
from agent.executor import Executor

class PlanAndSolveAgent:
    def __init__(self, llm_client):
        """
        初始化智能体，同时创建规划器和执行器实例。
        """
        self.llm_client = llm_client
        self.planner = Planner(self.llm_client)
        self.executor = Executor(self.llm_client)

    def run(self, question: str):
        """
        运行智能体的完整流程:先规划，后执行。
        """
        print(f"\n--- 开始处理问题 ---\n问题: {question}")
        
        # 1. 调用规划器生成计划
        plan = self.planner.plan(question)
        
        # 检查计划是否成功生成
        if not plan:
            print("\n--- 任务终止 --- \n无法生成有效的行动计划。")
            return

        # 2. 调用执行器执行计划
        final_answer = self.executor.execute(question, plan)
        
        print(f"\n--- 任务完成 ---\n最终答案: {final_answer}")
```

## Reflection

### 思路

1. 执行:调用llm获取初步结果
    
2. 反思:调用llm获取反思结果
    
3. 优化:调用llm根据反思结果来进一步优化结果
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=NWIwYWRlZDg2ZDAxZTg5MDVmYzQzYzE5MGY5NjU0NTRfZk1FNFZNNGQ2bEZwOHZsbmlocXJrY0tyZWVVRFdwQzdfVG9rZW46UkdwWWJoUEtSb0FJaWl4MnlYeWNlQWFWbmFiXzE3ODI4MzUyMzc6MTc4MjgzODgzN19WNA&add_watermark=true&scene_type=CCM)

### Memory

反思和优化的结果需要保存

因此定义一个Memory类

```Python
from typing import List, Dict, Any, Optional

class Memory:"""
    一个简单的短期记忆模块，用于存储智能体的行动与反思轨迹。
    """def __init__(self):"""
        初始化一个空列表来存储所有记录。
        """
        self.records: List[Dict[str, Any]] = []def add_record(self, record_type: str, content: str):"""
        向记忆中添加一条新记录。

        参数:
        - record_type (str): 记录的类型 ('execution' 或 'reflection')。
        - content (str): 记录的具体内容 (例如，生成的代码或反思的反馈)。
        """
        record = {"type": record_type, "content": content}
        self.records.append(record)print(f"📝 记忆已更新，新增一条 '{record_type}' 记录。")def get_trajectory(self) -> str:"""
        将所有记忆记录格式化为一个连贯的字符串文本，用于构建提示词。
        """
        trajectory_parts = []for record in self.records:if record['type'] == 'execution':
                trajectory_parts.append(f"--- 上一轮尝试 (代码) ---\n{record['content']}")elif record['type'] == 'reflection':
                trajectory_parts.append(f"--- 评审员反馈 ---\n{record['content']}")return "\n\n".join(trajectory_parts)def get_last_execution(self) -> Optional[str]:"""
        获取最近一次的执行结果 (例如，最新生成的代码)。
        如果不存在，则返回 None。
        """for record in reversed(self.records):if record['type'] == 'execution':return record['content']return None
```

### prompt设计

执行->反思->优化

需要三种提示词用于调用llm

（1）提示词设计

与之前的范式不同，Reflection 机制需要多个不同角色的提示词来协同工作。

1. 初始执行提示词 (Execution Prompt) ：这是智能体首次尝试解决问题的提示词，内容相对直接，只要求模型完成指定任务。
    

```Plain
INITIAL_PROMPT_TEMPLATE = """
你是一位资深的Python程序员。请根据以下要求，编写一个Python函数。
你的代码必须包含完整的函数签名、文档字符串，并遵循PEP 8编码规范。

要求: {task}

请直接输出代码，不要包含任何额外的解释。
"""Copy to clipboardErrorCopied
```

2. 反思提示词 (Reflection Prompt) ：这个提示词是 Reflection 机制的灵魂。它指示模型扮演“代码评审员”的角色，对上一轮生成的代码进行批判性分析，并提供具体的、可操作的反馈。
    

````Plain
REFLECT_PROMPT_TEMPLATE = """
你是一位极其严格的代码评审专家和资深算法工程师，对代码的性能有极致的要求。
你的任务是审查以下Python代码，并专注于找出其在<strong>算法效率</strong>上的主要瓶颈。

# 原始任务:{task}# 待审查的代码:
```python
{code}```

请分析该代码的时间复杂度，并思考是否存在一种<strong>算法上更优</strong>的解决方案来显著提升性能。
如果存在，请清晰地指出当前算法的不足，并提出具体的、可行的改进算法建议（例如，使用筛法替代试除法）。
如果代码在算法层面已经达到最优，才能回答“无需改进”。

请直接输出你的反馈，不要包含任何额外的解释。
"""Copy to clipboardErrorCopied
````

3. 优化提示词 (Refinement Prompt) ：当收到反馈后，这个提示词将引导模型根据反馈内容，对原有代码进行修正和优化。
    

```Plain

REFINE_PROMPT_TEMPLATE = """
你是一位资深的Python程序员。你正在根据一位代码评审专家的反馈来优化你的代码。

# 原始任务:{task}# 你上一轮尝试的代码:{last_code_attempt}
评审员的反馈：
{feedback}

请根据评审员的反馈，生成一个优化后的新版本代码。
你的代码必须包含完整的函数签名、文档字符串，并遵循PEP 8编码规范。
请直接输出优化后的代码，不要包含任何额外的解释。
"""
```

### ReflectionAgent

```Python
# 假设 llm_client.py 和 memory.py 已定义
from llm.hello_agent import HelloAgentsLLM
from memory.memory import Memory

class ReflectionAgent:
    def __init__(self, llm_client, max_iterations=3):
        self.llm_client = llm_client
        self.memory = Memory()
        self.max_iterations = max_iterations

    def run(self, task: str):
        print(f"\n--- 开始处理任务 ---\n任务: {task}")

        # --- 1. 初始执行 ---
        print("\n--- 正在进行初始尝试 ---")
        initial_prompt = INITIAL_PROMPT_TEMPLATE.format(task=task)
        initial_code = self._get_llm_response(initial_prompt)
        self.memory.add_record("execution", initial_code)

        # --- 2. 迭代循环:反思与优化 ---
        for i in range(self.max_iterations):
            print(f"\n--- 第 {i+1}/{self.max_iterations} 轮迭代 ---")

            # a. 反思
            print("\n-> 正在进行反思...")
            last_code = self.memory.get_last_execution()
            reflect_prompt = REFLECT_PROMPT_TEMPLATE.format(task=task, code=last_code)
            feedback = self._get_llm_response(reflect_prompt)
            self.memory.add_record("reflection", feedback)

            # b. 检查是否需要停止
            if "无需改进" in feedback:
                print("\n✅ 反思认为代码已无需改进，任务完成。")
                break

            # c. 优化
            print("\n-> 正在进行优化...")
            refine_prompt = REFINE_PROMPT_TEMPLATE.format(
                task=task,
                last_code_attempt=last_code,
                feedback=feedback
            )
            refined_code = self._get_llm_response(refine_prompt)
            self.memory.add_record("execution", refined_code)
        
        final_code = self.memory.get_last_execution()
        print(f"\n--- 任务完成 ---\n最终生成的代码:\n```python\n{final_code}\n```")
        return final_code

    def _get_llm_response(self, prompt: str) -> str:
        """一个辅助方法，用于调用LLM并获取完整的流式响应。"""
        messages = [{"role": "user", "content": prompt}]
        response_text = self.llm_client.think(messages=messages) or ""
        return response_text
```

# Langgraph

## 概念

LangGraph 将智能体的执行流程建模为一种**状态机**（State Machine），并将其表示为**有向图**（Directed Graph）。在这种范式中，图的节点（Nodes）代表一个具体的计算步骤（如调用 LLM、执行工具），而**边**（Edges）则定义了从一个节点到另一个节点的跳转逻辑。这种设计的革命性之处在于它天然支持循环，使得构建能够进行迭代、反思和自我修正的复杂智能体工作流变得前所未有的直观和简单。

## State

图的**全局状态**,所有节点都能读取和修改这个state

**state维护了整个调用流程的各种状态变量**

```Python
from typing import TypedDict, List

# 定义全局状态的数据结构
class AgentState(TypedDict):
    messages: List[str]      # 对话历史
    current_task: str        # 当前任务
    final_answer: str        # 最终答案
    # ... 任何其他需要追踪的状态+-
```

## Node

节点（Nodes）。每个节点都是一个**接收当前状态作为输入**、并**返回一个更新后的状态作为输出**的 **Python 函数**。节点是执行具体工作的单元。

```Python
from state import AgentState

# 定义一个“规划者”节点函数
def planner_node(state: AgentState) -> AgentState:
    """根据当前任务制定计划，并更新状态。"""
    current_task = state["current_task"]
    # ... 调用LLM生成计划 ...
    plan = f"为任务 '{current_task}' 生成的计划..."
    
    # 将新消息追加到状态中
    state["messages"].append(plan)
    return state

# 定义一个“执行者”节点函数
def executor_node(state: AgentState) -> AgentState:
    """执行最新计划，并更新状态。"""
    latest_plan = state["messages"][-1]
    # ... 执行计划并获得结果 ...
    result = f"执行计划 '{latest_plan}' 的结果..."
    
    state["messages"].append(result)
    return state
    
# 定义获取最终answer的结点
def finish_node(state: AgentState) -> AgentState:
    state["final_answer"] = state["messages"][-1]
    return state
    
```

## 条件函数

根据当前状态信息来决定返回结果

```Python
def should_continue(state: AgentState) -> str:
    """条件函数：根据状态决定下一步路由。"""
    # 假设如果消息少于3条，则需要继续规划
    if len(state["messages"]) < 3:
        # 返回的字符串需要与添加条件边时定义的键匹配
        return "continue_to_planner"
    else:
        state["final_answer"] = state["messages"][-1]
        return "end_workflow"
    
```

## 设置node、edge

条件边根据逻辑函数返回结果决定下一个结点

```Python
from langgraph.graph import StateGraph, END
from node import  planner_node, executor_node, should_continue, finish_node
from state import AgentState

# 初始化一个状态图，并绑定我们定义的状态结构
workflow = StateGraph(AgentState)

# 将节点函数添加到图中
workflow.add_node("planner", planner_node)
workflow.add_node("executor", executor_node)
workflow.add_node("finish", finish_node)

# 设置图的入口点
workflow.set_entry_point("planner")

# 添加常规边，连接 planner 和 executor
workflow.add_edge("planner", "executor")
workflow.add_edge("finish", END)

# 添加条件边，实现动态路由

workflow.add_conditional_edges("executor", should_continue, {
    "continue_to_planner": "planner",
    "end_workflow": "finish"   # ← 先走 finish 节点，再去 END
})

# 编译图，生成可执行的应用
app = workflow.compile()

# 运行图
inputs = {"current_task": "分析最近的AI行业新闻", "messages": []}
print(app.invoke(inputs)['final_answer'])
```

## TypedDict

作用于类

用类的方式描述字典,字段访问必须用[],运行时也是dict

```Python
from typing import TypedDict, List

# 定义全局状态的数据结构
class AgentState(TypedDict):
    messages: List[str]      # 对话历史
    current_task: str        # 当前任务
    final_answer: str        # 最终答案
    # ... 任何其他需要追踪的状态
```

# 三步问答助手

1. 理解 (Understand)：首先，分析用户的查询意图。
    
2. 搜索 (Search)：然后，模拟搜索与意图相关的信息。
    
3. 回答 (Answer)：最后，基于意图和搜索到的信息，生成最终答案。
    

## State

```Python
from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages

class SearchState(TypedDict):
    messages: Annotated[list, add_messages]
    user_query: str      # 经过LLM理解后的用户需求总结
    search_query: str    # 优化后用于Tavily API的搜索查询
    search_results: str  # Tavily搜索返回的结果
    final_answer: str    # 最终生成的答案
    step: str            # 标记当前步骤
```

## llm以及tavily_client

```Python
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from tavily import TavilyClient

# 加载 .env 文件中的环境变量
load_dotenv()

# 初始化模型
# 我们将使用这个 llm 实例来驱动所有节点的智能
llm = ChatOpenAI(
    model=os.getenv("LLM_MODEL_ID", "gpt-4o-mini"),
    api_key=os.getenv("LLM_API_KEY"),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
    temperature=0.7
)
# 初始化Tavily客户端
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
```

## Nodes

### 理解用户需求转换关键词

```Python
from tavily_client.tavily_client import tavily_client,llm
from state.state import SearchState
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

def understand_query_node(state: SearchState) -> SearchState:
    user_query= state['user_query']
    understand_query_prompt=f"""
    用户需求: {user_query}
    你需要完成两个任务:
    1. 理解用户的查询，并总结出用户的需求。
    2. 将用户的查询优化成一个适合搜索引擎使用的关键词
    回答格式:
    理解:[用户需求总结]
    关键词:[最佳搜索关键词]
    """
    res=llm.invoke([SystemMessage(content=understand_query_prompt)])
    res_text=res.content
    if "关键词" in res_text:
        search_query=res_text.split("关键词:")[1].strip()
        state['search_query']=search_query
    return state    

  
```

### tavily搜索

```Python
from tavily_client.tavily_client import tavily_client
from state.state import SearchState
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
def tavily_query_node(state: SearchState) -> SearchState:
  query=state['search_query']
  try:
    print(f"正在查询:{query}")
    res=tavily_client.search(query)
    state['search_results']=res
    state['step']='tavily查询成功'
  except Exception as e:  
    state['step']='tavily查询失败'
    state['search_results']=f"查询失败，错误信息: {str(e)}"
  return state  
```

### 生成最终回答

```Python
from state.state import SearchState
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from tavily_client.tavily_client import llm

def generate_answer_node(state: SearchState) -> SearchState:
  if state['step'] == 'tavily查询成功':
    search_results=state['search_results']
    generate_answer_prompt=f"""
    根据以下搜索结果，生成一个简洁的答案来回应用户的查询:
    用户查询: {state['user_query']}
    搜索结果: {search_results}
    """
    res=llm.invoke([SystemMessage(content=generate_answer_prompt)])
    state['final_answer']=res.content
  else :
    # llm自己回答
    self_answer_prompt=f"""
    由于api服务器异常，请基于你自身的知识回答用户的问题:\n
    用户查询: {state['user_query']}
    """
    res=llm.invoke([SystemMessage(content=self_answer_prompt)])
    state['final_answer']=res.content
  state['step']='生成答案完成'
  return state
```

## Main

```Python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver
from state.state import SearchState
from nodes.understand_query import understand_query_node
from nodes.tavily_query import tavily_query_node
from nodes.generate_answer import generate_answer_node

def create_search_assistant():
    workflow = StateGraph(SearchState)
    
    # 添加节点
    workflow.add_node("understand", understand_query_node)
    workflow.add_node("search", tavily_query_node)
    workflow.add_node("answer", generate_answer_node)
    
    # 设置线性流程
    workflow.add_edge(START, "understand")
    workflow.add_edge("understand", "search")
    workflow.add_edge("search", "answer")
    workflow.add_edge("answer", END)
    
    # 编译图
    # memory = InMemorySaver()
    app = workflow.compile()
    return app
def main():
    app = create_search_assistant()
    inputs = {"user_query": "介绍一下湖南城市学院", "messages": []}
    print(app.invoke(inputs)['final_answer'])

if __name__ == "__main__":
    main()    
```